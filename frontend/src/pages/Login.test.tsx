import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import Login from "./Login";

const loginFn = vi.fn();
const mockUseAuth = vi.fn();
vi.mock("../auth-context", () => ({
  useAuth: () => mockUseAuth(),
}));

describe("Login page", () => {
  beforeEach(() => {
    loginFn.mockReset();
    mockUseAuth.mockReturnValue({
      user: null,
      status: "anon",
      login: loginFn,
      logout: vi.fn(),
    });
  });
  afterEach(() => vi.clearAllMocks());

  it("renders email and password inputs and a submit button", () => {
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText(/email/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/password/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument();
  });

  it("calls auth.login on submit", async () => {
    loginFn.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/email/i), "you@example.com");
    await user.type(screen.getByLabelText(/password/i), "supersecret");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() =>
      expect(loginFn).toHaveBeenCalledWith("you@example.com", "supersecret"),
    );
  });

  it("shows error message when login fails", async () => {
    loginFn.mockRejectedValueOnce(new Error("Invalid credentials"));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/email/i), "x@y.com");
    await user.type(screen.getByLabelText(/password/i), "yyy");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    await waitFor(() => expect(screen.getByText(/invalid credentials/i)).toBeInTheDocument());
  });

  it("disables the button while submitting", async () => {
    let resolveLogin: () => void = () => {};
    loginFn.mockReturnValueOnce(new Promise<void>((r) => (resolveLogin = r)));
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Login />
      </MemoryRouter>,
    );
    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "pw");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(screen.getByRole("button", { name: /signing in/i })).toBeDisabled();
    resolveLogin();
  });
});
