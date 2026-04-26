import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Job } from "../api";
import { ProgressBar, formatDuration } from "../components/ProgressBar";

const STAGE_LABEL: Record<string, string> = {
  queued: "Queued",
  analyzing: "Analyzing",
  syncing: "Syncing",
  rendering: "Rendering",
  done: "Done",
  failed: "Failed",
  expired: "Expired",
};

const STAGE_HINT: Record<string, string> = {
  queued: "Waiting for the worker to pick this up",
  analyzing: "Probing the video and extracting reference audio",
  syncing: "Aligning your studio audio against the video — usually 5–30 s",
  rendering: "Encoding the final mp4",
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
        if ("detail" in event) next.progress_detail = event.detail ?? null;
        if ("eta_s" in event) next.progress_eta_s = event.eta_s ?? null;
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
  const detail = job.progress_detail ?? STAGE_HINT[job.progress_stage] ?? null;
  const elapsed = useElapsedSeconds(job.started_at, job.finished_at);
  const isActive = job.status !== "done" && job.status !== "failed";
  const showElapsed = isActive && job.started_at !== null;
  const showEta =
    isActive && job.progress_eta_s != null && job.progress_eta_s > 0;
  const showTiming = showElapsed || showEta;

  return (
    <section className="bg-ink-800 rounded-2xl p-5">
      <div className="flex items-center justify-between mb-1 text-sm">
        <span className="text-white/70">{stage}</span>
        <span className="tabular-nums">{Math.round(job.progress_pct)}%</span>
      </div>
      {detail && (
        <p className="text-xs text-white/50 mb-2 truncate" title={detail}>
          {detail}
        </p>
      )}
      <ProgressBar value={job.progress_pct} />
      {showTiming && (
        <div className="mt-2 flex items-center justify-between text-xs text-white/50 tabular-nums">
          <span>{showElapsed ? `Elapsed ${formatDuration(elapsed)}` : ""}</span>
          {showEta && <span>ETA {formatDuration(job.progress_eta_s!)}</span>}
        </div>
      )}
      {job.sync_offset_ms != null && (
        <p className="mt-3 text-xs text-white/50">
          Aligned audio offset: {job.sync_offset_ms.toFixed(0)} ms
          {job.sync_confidence != null && ` (confidence ${(job.sync_confidence * 100).toFixed(0)}%)`}
        </p>
      )}
    </section>
  );
}

function useElapsedSeconds(startedAt: string | null, finishedAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!startedAt || finishedAt) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [startedAt, finishedAt]);
  if (!startedAt) return 0;
  const end = finishedAt ? new Date(finishedAt).getTime() : now;
  return Math.max(0, (end - new Date(startedAt).getTime()) / 1000);
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
