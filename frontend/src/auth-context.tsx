import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import { api, User } from "./api";

export type AuthStatus = "loading" | "anon" | "authed";

interface AuthState {
  user: User | null;
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const Ctx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<AuthStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setStatus(u ? "authed" : "anon");
      })
      .catch(() => {
        if (!cancelled) setStatus("anon");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const u = await api.login(email, password);
    setUser(u);
    setStatus("authed");
  }, []);

  const logout = useCallback(async () => {
    await api.logout();
    setUser(null);
    setStatus("anon");
  }, []);

  return <Ctx.Provider value={{ user, status, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth used outside AuthProvider");
  return v;
}
