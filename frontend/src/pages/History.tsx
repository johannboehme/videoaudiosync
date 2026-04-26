import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, Job } from "../api";
import { ChunkyButton } from "../editor/components/ChunkyButton";
import { RuleStrip } from "../editor/components/RuleStrip";
import { TrashIcon } from "../editor/components/icons";
import { formatDuration } from "../components/ProgressBar";

const ACTIVE_STATUSES: Job["status"][] = ["queued", "analyzing", "syncing", "rendering"];

export default function History() {
  const [jobs, setJobs] = useState<Job[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const load = async () => {
      try {
        const next = await api.listJobs();
        if (cancelled) return;
        setJobs(next);
        if (next.some((j) => ACTIVE_STATUSES.includes(j.status))) {
          timer = window.setTimeout(load, 3000);
        }
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : "Failed to load");
      }
    };
    load();
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  async function remove(id: string) {
    if (!window.confirm("Delete this job and its files?")) return;
    await api.deleteJob(id);
    setJobs((curr) => (curr ? curr.filter((j) => j.id !== id) : curr));
  }

  if (err)
    return (
      <main className="flex-1 max-w-7xl w-full mx-auto px-6 py-10">
        <p className="font-mono text-sm text-danger">{err}</p>
      </main>
    );
  if (!jobs)
    return (
      <main className="flex-1 flex items-center justify-center">
        <span className="font-mono text-xs text-ink-2 tracking-label uppercase">
          Loading…
        </span>
      </main>
    );

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-label uppercase text-ink-2">
            HISTORY · {String(jobs.length).padStart(2, "0")}
          </span>
          <RuleStrip count={32} className="text-rule flex-1 max-w-[200px]" />
        </div>
        <div className="flex items-end justify-between gap-3">
          <h1 className="font-display font-semibold text-3xl sm:text-5xl text-ink leading-none">
            Your jobs
          </h1>
          <Link to="/" className="hidden sm:block">
            <ChunkyButton variant="primary" size="md">
              + New
            </ChunkyButton>
          </Link>
        </div>
      </header>

      {jobs.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {jobs.map((j) => (
            <JobCard key={j.id} job={j} onDelete={() => remove(j.id)} />
          ))}
        </ul>
      )}
    </main>
  );
}

function JobCard({ job, onDelete }: { job: Job; onDelete: () => void }) {
  const isActive = ACTIVE_STATUSES.includes(job.status);
  return (
    <li className="group relative bg-paper-hi border border-rule rounded-lg overflow-hidden hover:border-ink-2 transition-colors">
      <Link to={`/job/${job.id}`} className="block">
        {/* thumbnail strip — falls back to ink panel if not ready */}
        <div className="aspect-[16/7] bg-sunken overflow-hidden relative">
          <img
            src={api.thumbnailsUrl(job.id)}
            alt=""
            className="w-full h-full object-cover object-left"
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.display = "none";
            }}
          />
          <div className="absolute top-2 left-2 flex items-center gap-1.5">
            <StatusBadge status={job.status} />
          </div>
          {job.duration_s != null && (
            <span className="absolute bottom-2 right-2 font-mono text-[10px] tabular tracking-label uppercase text-paper-hi bg-sunken/70 px-1.5 py-0.5 rounded-sm">
              {formatDuration(job.duration_s)}
            </span>
          )}
        </div>

        <div className="p-3 flex flex-col gap-2">
          <div className="flex items-start justify-between gap-2">
            <h2 className="font-display font-semibold text-base text-ink truncate">
              {job.title || job.id.slice(0, 12)}
            </h2>
          </div>
          <div className="flex items-center justify-between font-mono text-[11px] tabular text-ink-2">
            <span>{new Date(job.created_at).toLocaleString()}</span>
            {job.sync_offset_ms != null && (
              <span className="text-hot">
                {job.sync_offset_ms > 0 ? "+" : ""}
                {job.sync_offset_ms.toFixed(0)}ms
              </span>
            )}
          </div>

          {isActive && (
            <div className="flex items-center gap-2 mt-1">
              <div
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(job.progress_pct)}
                className="flex-1 h-1 bg-paper-deep rounded-full overflow-hidden"
              >
                <div
                  className="h-full bg-hot transition-all"
                  style={{ width: `${job.progress_pct}%` }}
                />
              </div>
              <span className="font-mono text-[10px] tabular text-ink-2 shrink-0">
                {Math.round(job.progress_pct)}%
              </span>
            </div>
          )}
        </div>
      </Link>
      <button
        onClick={(e) => {
          e.preventDefault();
          onDelete();
        }}
        className="absolute top-2 right-2 h-7 w-7 inline-flex items-center justify-center rounded-md bg-paper-hi/90 backdrop-blur text-ink-2 hover:text-danger opacity-0 group-hover:opacity-100 transition-opacity"
        aria-label="Delete job"
      >
        <TrashIcon width={14} height={14} />
      </button>
    </li>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<string, { bg: string; text: string }> = {
    done: { bg: "bg-success/90 text-paper-hi", text: "DONE" },
    failed: { bg: "bg-danger/90 text-paper-hi", text: "FAIL" },
    queued: { bg: "bg-ink/80 text-paper-hi", text: "QUEUED" },
    analyzing: { bg: "bg-hot/90 text-paper-hi", text: "PROBE" },
    syncing: { bg: "bg-hot/90 text-paper-hi", text: "ALIGN" },
    rendering: { bg: "bg-hot/90 text-paper-hi", text: "RENDER" },
    expired: { bg: "bg-ink-2/80 text-paper-hi", text: "EXPIRED" },
  };
  const it = map[status] || map.queued;
  return (
    <span
      className={[
        "inline-flex items-center h-5 px-1.5 rounded-sm font-mono text-[10px] tracking-label uppercase",
        it.bg,
      ].join(" ")}
    >
      {it.text}
    </span>
  );
}

function EmptyState() {
  return (
    <div className="grid sm:grid-cols-[1.2fr_1fr] gap-6 sm:gap-8 items-center bg-paper-hi border border-rule rounded-lg p-8 sm:p-12">
      <div>
        <span className="label mb-3 block">Nothing here yet</span>
        <h2 className="font-display font-semibold text-3xl sm:text-4xl leading-tight text-ink mb-3">
          No jobs.
          <br />
          <span className="text-hot">Drop a video.</span>
        </h2>
        <p className="text-ink-2 max-w-sm mb-5">
          Upload your first phone-or-glasses video plus the matching studio
          audio. Auto-sync runs in seconds.
        </p>
        <Link to="/">
          <ChunkyButton variant="primary" size="md">
            + Upload
          </ChunkyButton>
        </Link>
      </div>
      {/* Decorative TE-style mark */}
      <div className="hidden sm:block">
        <svg viewBox="0 0 200 200" className="w-full max-w-[260px] mx-auto">
          <rect
            x="2"
            y="2"
            width="196"
            height="196"
            stroke="#C9BFA6"
            strokeDasharray="4 6"
            fill="none"
          />
          <circle cx="100" cy="100" r="60" stroke="#1A1816" strokeWidth="1.5" fill="none" />
          <circle cx="100" cy="100" r="6" fill="#FF5722" />
          <line x1="20" y1="100" x2="180" y2="100" stroke="#1A1816" strokeWidth="0.5" />
          <line x1="100" y1="20" x2="100" y2="180" stroke="#1A1816" strokeWidth="0.5" />
          <text
            x="100"
            y="195"
            textAnchor="middle"
            fontFamily='"JetBrains Mono", monospace'
            fontSize="9"
            fill="#5C544A"
            letterSpacing="2"
          >
            DROP HERE
          </text>
        </svg>
      </div>
    </div>
  );
}
