import { ReactNode } from "react";
import { Link, Navigate, Route, Routes, useLocation } from "react-router-dom";
import { useAuth } from "./auth-context";
import Editor from "./pages/Editor";
import History from "./pages/History";
import JobPage from "./pages/JobPage";
import Login from "./pages/Login";
import Upload from "./pages/Upload";

export default function App() {
  return (
    <div className="min-h-full flex flex-col">
      <TopBar />
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
    return <p className="p-6 text-white/60">Loading…</p>;
  }
  if (status === "anon") {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  return <>{children}</>;
}

function TopBar() {
  const { user, status, logout } = useAuth();
  return (
    <header className="border-b border-ink-700 bg-ink-800/80 backdrop-blur">
      <div className="max-w-3xl mx-auto px-4 py-3 flex items-center justify-between">
        <Link to="/" className="font-semibold tracking-tight">
          VideoAudioSync
        </Link>
        {status === "authed" && (
          <div className="flex items-center gap-3 text-sm">
            <Link to="/jobs" className="text-white/70 hover:text-white">
              History
            </Link>
            <Link to="/" className="text-white/70 hover:text-white">
              New
            </Link>
            <span className="text-white/30 hidden sm:inline">{user?.email}</span>
            <button
              onClick={() => logout()}
              className="text-white/70 hover:text-white"
            >
              Sign out
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
