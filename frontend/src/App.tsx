import { ReactNode } from "react";
import { Link, Navigate, NavLink, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import { RegistrationMark } from "./editor/components/RuleStrip";
import Editor from "./pages/Editor";
import History from "./pages/History";
import JobPage from "./pages/JobPage";
import Login from "./pages/Login";
import Upload from "./pages/Upload";

export default function App() {
  const location = useLocation();
  const isEditor = /^\/job\/[^/]+\/edit/.test(location.pathname);
  return (
    <div className="min-h-full flex flex-col paper-bg">
      {!isEditor && <TopBar />}
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <Protected>
              <Upload />
            </Protected>
          }
        />
        <Route
          path="/jobs"
          element={
            <Protected>
              <History />
            </Protected>
          }
        />
        <Route
          path="/job/:id"
          element={
            <Protected>
              <JobPage />
            </Protected>
          }
        />
        <Route
          path="/job/:id/edit"
          element={
            <Protected>
              <Editor />
            </Protected>
          }
        />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();
  if (status === "loading") {
    return (
      <main className="flex-1 flex items-center justify-center">
        <span className="font-mono text-xs text-ink-2 tracking-label uppercase">
          Loading…
        </span>
      </main>
    );
  }
  if (status === "anon") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

function TopBar() {
  const { user, status, logout } = useAuth();
  return (
    <header className="border-b border-rule bg-paper-hi shadow-panel">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between gap-4">
        <Link to="/" className="flex items-center gap-2.5 group">
          <RegistrationMark className="text-hot" />
          <div className="leading-none">
            <span className="font-display tracking-label uppercase text-[11px] text-ink-2 block">
              VAS
            </span>
            <span className="font-display text-[15px] font-semibold text-ink leading-none block">
              Video / Audio Sync
            </span>
          </div>
        </Link>
        {status === "authed" && (
          <nav className="flex items-center gap-1">
            <NavTab to="/" end>
              New
            </NavTab>
            <NavTab to="/jobs">History</NavTab>
            <span className="hidden md:inline-block ml-2 mr-1 font-mono text-[11px] text-ink-3 tabular">
              {user?.email}
            </span>
            <button
              onClick={() => logout()}
              className="h-9 px-3 text-[11px] font-display tracking-label uppercase text-ink-2 hover:text-ink rounded-md"
            >
              Sign out
            </button>
          </nav>
        )}
      </div>
    </header>
  );
}

function NavTab({
  to,
  end,
  children,
}: {
  to: string;
  end?: boolean;
  children: ReactNode;
}) {
  return (
    <NavLink
      to={to}
      end={end}
      className={({ isActive }) =>
        [
          "h-9 px-3 inline-flex items-center font-display tracking-label uppercase text-[11px] rounded-md",
          isActive ? "bg-ink text-paper-hi" : "text-ink-2 hover:text-ink",
        ].join(" ")
      }
    >
      {children}
    </NavLink>
  );
}
