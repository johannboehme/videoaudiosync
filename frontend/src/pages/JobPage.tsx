import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Job } from "../api";

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  syncing: "Syncing",
  rendering: "Rendering",
  done: "Done",
  failed: "Failed",
  expired: "Expired",
};

export default function JobPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [job, setJob] = useState<Job | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getJob(id).then(setJob).catch((e) => setErr(e.message));
    const unsubscribe = api.subscribeJob(id, (event) => {
      setJob((prev) => {
        if (!prev) return prev;
        const next = { ...prev };
        if (typeof event.progress === "number") next.progress_pct = event.progress;
        if (typeof event.stage === "string") next.progress_stage = event.stage;
        if (typeof event.status === "string") next.status = event.status as Job["status"];
        if (typeof event.error === "string") next.error = event.error;
        if (event.status === "done") next.has_output = true;
        return next;
      });
    });
    return unsubscribe;
  }, [id]);

  if (err) return <Banner kind="error" text={err} />;
  if (!job) return <Banner kind="info" text="Loading…" />;

  return (
    <main className="min-h-full p-4 sm:p-6 max-w-2xl mx-auto space-y-5">
      <header>
        <h1 className="text-2xl font-semibold">{job.title || job.id}</h1>
        <p className="text-white/60 text-sm">
          {job.video_filename} · {job.audio_filename}
        </p>
      </header>

      <ProgressCard job={job} />

      {job.sync_warning && (
        <Banner kind="warn" text={job.sync_warning} />
      )}
      {job.error && <Banner kind="error" text={job.error} />}

      {job.status === "done" && job.has_output && (
        <div className="flex flex-wrap gap-3">
          <a
            href={api.downloadUrl(job.id)}
            className="bg-accent-600 hover:bg-accent-500 transition rounded-xl px-4 py-3 font-medium"
          >
            Download MP4
          </a>
          <Link
            to={`/job/${job.id}/edit`}
            className="bg-ink-700 hover:bg-ink-600 transition rounded-xl px-4 py-3 font-medium"
          >
            Open editor
          </Link>
        </div>
      )}
    </main>
  );
}

function ProgressCard({ job }: { job: Job }) {
  const stage = STAGE_LABEL[job.progress_stage] || job.progress_stage;
  return (
    <section className="bg-ink-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-2 text-sm">
        <span className="text-white/70">{stage}</span>
        <span className="tabular-nums">{Math.round(job.progress_pct)}%</span>
      </div>
      <div className="h-2 bg-ink-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-accent-500 transition-all"
          style={{ width: `${Math.min(100, Math.max(0, job.progress_pct))}%` }}
        />
      </div>
      {job.sync_offset_ms != null && (
        <p className="mt-3 text-xs text-white/50">
          Aligned audio offset: {job.sync_offset_ms.toFixed(0)} ms
          {job.sync_confidence != null && ` (confidence ${(job.sync_confidence * 100).toFixed(0)}%)`}
        </p>
      )}
    </section>
  );
}

function Banner({ kind, text }: { kind: "info" | "warn" | "error"; text: string }) {
  const colors =
    kind === "error"
      ? "bg-red-900/40 text-red-200"
      : kind === "warn"
      ? "bg-yellow-900/40 text-yellow-200"
      : "bg-ink-800 text-white/70";
  return <div className={`rounded-xl px-4 py-3 ${colors}`}>{text}</div>;
}
