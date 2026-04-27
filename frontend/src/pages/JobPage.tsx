import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ChunkyButton } from "../editor/components/ChunkyButton";
import { MonoReadout } from "../editor/components/MonoReadout";
import { RuleStrip } from "../editor/components/RuleStrip";
import { DownloadIcon } from "../editor/components/icons";
import {
  deleteJob,
  jobEvents,
  jobsDb,
  resolveJobAssetUrl,
  runQuickRender,
  type LocalJob,
} from "../local/jobs";

const PIPELINE = [
  { key: "queued", label: "Queue" },
  { key: "syncing", label: "Sync" },
  { key: "synced", label: "Synced" },
  { key: "rendering", label: "Render" },
  { key: "rendered", label: "Done" },
] as const;

export default function JobPage() {
  const { id = "" } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<LocalJob | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let active = true;
    jobsDb.getJob(id).then((j) => {
      if (active) setJob(j ?? null);
    });
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<{ jobId: string; job: LocalJob }>).detail;
      if (detail.jobId !== id) return;
      setJob({ ...detail.job });
    };
    jobEvents.addEventListener("update", handler);
    return () => {
      active = false;
      jobEvents.removeEventListener("update", handler);
    };
  }, [id]);

  // Build a download URL when an output appears.
  useEffect(() => {
    if (!job?.hasOutput) return;
    let url: string | null = null;
    let cancelled = false;
    resolveJobAssetUrl(job.id, "output").then((u) => {
      if (cancelled) {
        if (u) URL.revokeObjectURL(u);
        return;
      }
      url = u;
      setDownloadUrl(u);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setDownloadUrl(null);
    };
  }, [job?.hasOutput, job?.id]);

  async function onQuickRender() {
    if (!job) return;
    setErr(null);
    try {
      await runQuickRender(job.id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Render failed");
    }
  }

  async function onDelete() {
    if (!job) return;
    if (!window.confirm("Delete this job and its files?")) return;
    await deleteJob(job.id);
    navigate("/jobs");
  }

  if (err) return <Banner kind="error" text={err} />;
  if (!job) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <span className="font-mono text-xs text-ink-2 tracking-label uppercase">
          Loading job…
        </span>
      </main>
    );
  }

  const isDone = job.status === "rendered" || job.status === "synced";
  const isFailed = job.status === "failed";
  // A failed job that already has a sync result is recoverable: the
  // sync data lets the user re-enter the editor or kick off another
  // render attempt without redoing the upload + analysis.
  const canRetry = isFailed && Boolean(job.sync);

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
      <header className="mb-6 flex flex-col gap-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs tracking-label uppercase text-ink-2">
            JOB · {job.id.slice(0, 8)}
          </span>
          <RuleStrip count={32} className="text-rule flex-1 max-w-[200px]" />
          <StatusBadge status={job.status} />
        </div>
        <h1 className="font-display font-semibold text-3xl sm:text-4xl text-ink truncate">
          {job.title || job.id}
        </h1>
        <p className="font-mono text-xs text-ink-2">
          {job.videoFilename} · {job.audioFilename}
        </p>
      </header>

      <section className="mb-6">
        <Pipeline status={job.status} progressPct={job.progress.pct} />
      </section>

      <section className="mb-6 grid sm:grid-cols-3 gap-3">
        <MonoReadout
          label="OFFSET"
          value={job.sync ? `${job.sync.offsetMs.toFixed(1)} ms` : "—"}
          align="left"
        />
        <MonoReadout
          label="CONFIDENCE"
          value={job.sync ? `${(job.sync.confidence * 100).toFixed(0)}%` : "—"}
          align="left"
        />
        <MonoReadout
          label="DRIFT"
          value={
            job.sync
              ? `${((job.sync.driftRatio - 1) * 100).toFixed(3)}%`
              : "—"
          }
          align="left"
        />
      </section>

      {isFailed && job.error && <Banner kind="error" text={job.error} />}
      {err && <Banner kind="error" text={err} />}

      {(isDone || canRetry) && (
        <div className="flex flex-wrap gap-3 border-t border-rule pt-5">
          <ChunkyButton variant="primary" size="lg" onClick={onQuickRender}>
            {canRetry ? "Retry quick render" : "Quick render"}
          </ChunkyButton>
          <ChunkyButton variant="secondary" size="lg">
            <Link to={`/job/${job.id}/edit`}>Open editor</Link>
          </ChunkyButton>
          {downloadUrl && (
            <a
              href={downloadUrl}
              download={`${job.title || job.id}.mp4`}
              className="inline-flex items-center gap-2 h-12 px-5 rounded-md bg-cobalt text-paper-hi font-display tracking-label uppercase text-xs hover:bg-cobalt/90"
            >
              <DownloadIcon className="w-4 h-4" />
              Download MP4
            </a>
          )}
          <ChunkyButton variant="ghost" size="lg" onClick={onDelete}>
            Delete
          </ChunkyButton>
        </div>
      )}

      {/* Sync also failed — only recovery is to delete and retry the upload. */}
      {isFailed && !job.sync && (
        <div className="flex flex-wrap gap-3 border-t border-rule pt-5">
          <ChunkyButton variant="ghost" size="lg" onClick={onDelete}>
            Delete and start over
          </ChunkyButton>
        </div>
      )}
    </main>
  );
}

function Pipeline({ status, progressPct }: { status: string; progressPct: number }) {
  // Find the active stage index.
  const activeIdx = Math.max(
    0,
    PIPELINE.findIndex((s) => s.key === status),
  );
  return (
    <ol className="flex items-stretch gap-1 bg-paper-hi border border-rule rounded-md p-2">
      {PIPELINE.map((stage, i) => {
        const passed = i < activeIdx;
        const active = i === activeIdx;
        return (
          <li
            key={stage.key}
            className={[
              "flex-1 px-3 py-3 rounded text-center font-display tracking-label uppercase text-[11px]",
              active ? "bg-hot text-paper-hi" : passed ? "bg-success/20 text-success" : "text-ink-3",
            ].join(" ")}
          >
            <div>{stage.label}</div>
            {active && (
              <div className="mt-1 font-mono text-[10px] text-paper-hi/80 tabular">
                {Math.round(progressPct)}%
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function StatusBadge({ status }: { status: string }) {
  return (
    <span className="font-mono text-[10px] tracking-label uppercase text-ink-2 bg-paper-hi border border-rule rounded-full px-2 py-0.5">
      {status}
    </span>
  );
}

function Banner({ kind, text }: { kind: "error"; text: string }) {
  return (
    <div
      className={[
        "border-l-2 pl-3 py-2 text-sm font-mono",
        kind === "error" ? "border-danger text-danger" : "",
      ].join(" ")}
    >
      {text}
    </div>
  );
}
