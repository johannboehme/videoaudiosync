import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth-context";

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const next = (location.state as { from?: string } | null)?.from || "/";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      await login(email, password);
      navigate(next, { replace: true });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Login failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-full flex items-center justify-center p-6">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-ink-800 rounded-2xl p-6 space-y-4 shadow-xl"
      >
        <h1 className="text-xl font-semibold">Sign in</h1>
        <label className="block text-sm">
          <span className="text-white/70">Email</span>
          <input
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full bg-ink-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent-500"
          />
        </label>
        <label className="block text-sm">
          <span className="text-white/70">Password</span>
          <input
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full bg-ink-700 rounded-lg px-3 py-2 outline-none focus:ring-2 focus:ring-accent-500"
          />
        </label>
        {err && <p className="text-sm text-red-400">{err}</p>}
        <button
          type="submit"
          disabled={busy}
          className="w-full bg-accent-600 hover:bg-accent-500 disabled:opacity-50 transition rounded-lg px-3 py-2 font-medium"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </main>
  );
}
