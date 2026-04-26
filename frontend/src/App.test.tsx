import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "./auth-context";

const meMock = vi.fn();
vi.mock("./api", () => ({
  api: {
    me: () => meMock(),
    listJobs: vi.fn().mockResolvedValue([]),
    getJob: vi.fn(),
    uploadJob: vi.fn(),
  },
}));

describe("App routing + protected routes", () => {
  beforeEach(() => meMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("redirects to /login when unauthenticated and visiting /", async () => {
    meMock.mockResolvedValueOnce(null);
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByRole("button", { name: /sign in/i })).toBeInTheDocument());
  });

  it("renders Upload page at / when authenticated", async () => {
    meMock.mockResolvedValueOnce({ id: "u1", email: "a@b.com" });
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/sync your performance/i)).toBeInTheDocument());
  });
});
