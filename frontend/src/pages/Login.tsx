import { FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth-context";
import { ChunkyButton } from "../editor/components/ChunkyButton";
import { RuleStrip } from "../editor/components/RuleStrip";

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
    <main className="flex-1 grid lg:grid-cols-[1.1fr_1fr] gap-0 min-h-[calc(100vh-3.5rem)]">
      {/* Left: bold typographic decoration */}
      <aside className="hidden lg:flex flex-col justify-between bg-ink text-paper-hi p-10 relative overflow-hidden">
        <div className="flex items-center gap-2 font-display tracking-label uppercase text-[11px] text-ink-3">
          <span className="inline-block w-2 h-2 rounded-full bg-hot" /> ACCESS · SECURE
        </div>
        <div>
          <h2 className="font-display font-semibold text-[clamp(48px,7vw,96px)] leading-[0.92] tracking-tight">
            Sync<br />
            <span className="text-hot">studio</span> to<br />
            phone.
          </h2>
          <p className="mt-6 max-w-sm text-paper-hi/60 text-sm leading-relaxed">
            Auto-aligned by chroma + drift. Then nudge the offset by ms with a
            real knob, until it's perfect.
          </p>
        </div>
        <div className="space-y-2">
          <RuleStrip count={48} className="text-paper-hi/30" />
          <div className="flex items-center justify-between font-mono text-[10px] tracking-label uppercase text-paper-hi/40">
            <span>v.0.2</span>
            <span>SIGN-IN-01</span>
          </div>
        </div>
      </aside>

      {/* Right: form */}
      <section className="flex items-center justify-center p-6 sm:p-10">
        <form
          onSubmit={handleSubmit}
          className="w-full max-w-md flex flex-col gap-6"
        >
          <header className="flex flex-col gap-2">
            <span className="label text-ink-2">01 / Sign in</span>
            <h1 className="font-display font-semibold text-3xl text-ink">
              Welcome back
            </h1>
            <p className="text-sm text-ink-2">
              Use your existing credentials.
            </p>
          </header>

          <Field id="email" label="Email">
            <input
              id="email"
              type="email"
              autoComplete="email"
              inputMode="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-11 w-full bg-paper-hi border border-rule rounded-md px-3 font-mono text-sm focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/30"
            />
          </Field>

          <Field id="password" label="Password">
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-11 w-full bg-paper-hi border border-rule rounded-md px-3 font-mono text-sm focus:border-cobalt focus:outline-none focus:ring-2 focus:ring-cobalt/30"
            />
          </Field>

          {err && (
            <div className="border-l-2 border-danger pl-3 py-1.5 text-sm text-danger font-mono">
              {err}
            </div>
          )}

          <ChunkyButton
            type="submit"
            variant="primary"
            size="lg"
            fullWidth
            disabled={busy}
          >
            {busy ? "Signing in…" : "Sign in"}
          </ChunkyButton>
        </form>
      </section>
    </main>
  );
}

function Field({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="label">
        {label}
      </label>
      {children}
    </div>
  );
}
