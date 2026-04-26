import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./auth-context";

const meMock = vi.fn();
const loginMock = vi.fn();
const logoutMock = vi.fn();

vi.mock("./api", () => ({
  api: {
    me: () => meMock(),
    login: (...a: unknown[]) => loginMock(...a),
    logout: () => logoutMock(),
  },
}));

function Probe() {
  const { user, status, login, logout } = useAuth();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{user?.email ?? "anon"}</span>
      <button onClick={() => login("a@b.com", "pw")}>login</button>
      <button onClick={() => logout()}>logout</button>
    </div>
  );
}

describe("AuthProvider", () => {
  beforeEach(() => {
    meMock.mockReset();
    loginMock.mockReset();
    logoutMock.mockReset();
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("starts in 'loading' then resolves to anon when /me returns null", async () => {
    meMock.mockResolvedValueOnce(null);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByTestId("status").textContent).toBe("loading");
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
    expect(screen.getByTestId("email").textContent).toBe("anon");
  });

  it("resolves to authed with the user when /me returns one", async () => {
    meMock.mockResolvedValueOnce({ id: "u1", email: "a@b.com" });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    expect(screen.getByTestId("email").textContent).toBe("a@b.com");
  });

  it("login() updates the user and status on success", async () => {
    meMock.mockResolvedValueOnce(null);
    loginMock.mockResolvedValueOnce({ id: "u1", email: "a@b.com" });
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));

    await act(async () => {
      screen.getByText("login").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    expect(screen.getByTestId("email").textContent).toBe("a@b.com");
    expect(loginMock).toHaveBeenCalledWith("a@b.com", "pw");
  });

  it("logout() clears the user", async () => {
    meMock.mockResolvedValueOnce({ id: "u1", email: "a@b.com" });
    logoutMock.mockResolvedValueOnce(undefined);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("authed"));
    await act(async () => {
      screen.getByText("logout").click();
    });
    await waitFor(() => expect(screen.getByTestId("status").textContent).toBe("anon"));
  });
});
