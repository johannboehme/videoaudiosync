import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Job } from "../api";

export default function History() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.listJobs().then(setJobs).catch((e) => setErr(e.message));
  }, []);

  async function remove(id: string) {
    if (!window.confirm("Delete this job and its files?")) return;
    await api.deleteJob(id);
    setJobs((curr) => (curr ? curr.filter((j) => j.id !== id) : curr));
  }

  if (err) return <p className="p-6 text-red-400">{err}</p>;
  if (!jobs) return <p className="p-6 text-white/60">Loading…</p>;
  if (jobs.length === 0) {
    return (
      <main className="p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-semibold mb-3">Your jobs</h1>
        <p className="text-white/60">No jobs yet — drop a video on the upload page.</p>
        <Link to="/" className="inline-block mt-4 underline text-accent-400">
          Go to upload
        </Link>
      </main>
    );
  }
  return (
    <main className="p-4 sm:p-6 max-w-2xl mx-auto">
      <h1 className="text-2xl font-semibold mb-4">Your jobs</h1>
      <ul className="space-y-3">
        {jobs.map((j) => (
          <li
            key={j.id}
            className="flex items-center justify-between bg-ink-800 rounded-2xl px-4 py-3"
          >
            <Link to={`/job/${j.id}`} className="block flex-1 min-w-0">
              <div className="font-medium truncate">{j.title || j.id}</div>
              <div className="text-sm text-white/50">
                {j.status} · {new Date(j.created_at).toLocaleString()}
              </div>
            </Link>
            <button
              onClick={() => remove(j.id)}
              className="ml-3 text-sm text-red-400 hover:text-red-300"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
}
