import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api, Job } from "../api";
import { ChunkyButton } from "../editor/components/ChunkyButton";
import { MonoReadout } from "../editor/components/MonoReadout";
import { RuleStrip } from "../editor/components/RuleStrip";
import { DownloadIcon } from "../editor/components/icons";
import { formatDuration } from "../components/ProgressBar";

const STAGES = [
  { key: "queued", label: "Queue" },
  { key: "analyzing", label: "Probe" },
  { key: "syncing", label: "Align" },
  { key: "rendering", label: "Render" },
  { key: "done", label: "Done" },
] as const;

const STAGE_HINT: Record<string, string> = {
  queued: "Waiting for the worker to pick this up",
  analyzing: "Probing video, extracting reference audio, peaks + thumbs",
  syncing: "Aligning your studio audio against the video — usually 5–30 s",
  rendering: "Encoding the final mp4 with the algorithm-computed offset",
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
  if (!job) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <span className="font-mono text-xs text-ink-2 tracking-label uppercase">
          Loading job…
        </span>
      </main>
    );
  }

  const isDone = job.status === "done";
  const isFailed = job.status === "failed";
  const isActive = !isDone && !isFailed;

  return (
    <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 py-6 sm:py-10">
      {/* Header strip: id + filenames */}
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
          {job.video_filename} · {job.audio_filename}
        </p>
      </header>

      {/* Asymmetric main grid: percent on left, stages on right */}
      <section className="grid lg:grid-cols-[1fr_1.6fr] gap-3 lg:gap-4 mb-4">
        <BigPercent value={job.progress_pct} status={job.status} />
        <StageDiagram stage={job.progress_stage} status={job.status} />
      </section>

      {/* Detail strip */}
      <section className="bg-paper-hi border border-rule rounded-md p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-col gap-1">
          <span className="label">{stageLabel(job.progress_stage)}</span>
          <p className="text-sm text-ink-2">
            {job.progress_detail ?? STAGE_HINT[job.progress_stage] ?? "—"}
          </p>
        </div>
        <Timing job={job} isActive={isActive} />
      </section>

      {/* Sync metrics */}
      {job.sync_offset_ms != null && (
        <section className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-4">
          <MonoReadout
            label="Algo offset"
            size="md"
            tone="hot"
            align="center"
            value={`${job.sync_offset_ms.toFixed(0)} ms`}
          />
          <MonoReadout
            label="Confidence"
            size="md"
            tone="default"
            align="center"
            value={
              job.sync_confidence != null
                ? `${(job.sync_confidence * 100).toFixed(0)}%`
                : "—"
            }
          />
          <MonoReadout
            label="Drift"
            size="md"
            tone="default"
            align="center"
            value={
              job.sync_drift_ratio != null
                ? `${((job.sync_drift_ratio - 1) * 1000).toFixed(2)} ‰`
                : "—"
            }
          />
        </section>
      )}

      {/* Warnings + errors */}
      {job.sync_warning && <Banner kind="warn" text={job.sync_warning} className="mb-3" />}
      {job.error && <Banner kind="error" text={job.error} className="mb-3" />}

      {/* Done CTA — full-width, asymmetric color block */}
      {isDone && job.has_output && (
        <section className="grid sm:grid-cols-[1.6fr_1fr] gap-3 mt-6">
          <a
            href={api.downloadUrl(job.id)}
            className="group flex items-center justify-between gap-4 bg-hot text-paper-hi rounded-lg px-5 sm:px-6 py-5 sm:py-6 shadow-hot hover:bg-hot-pressed transition-colors"
          >
            <div>
              <div className="font-display tracking-label uppercase text-[11px] opacity-80">
                Output ready
              </div>
              <div className="font-display font-semibold text-2xl sm:text-3xl mt-0.5">
                Download MP4
              </div>
            </div>
            <DownloadIcon width={28} height={28} />
          </a>
          <Link
            to={`/job/${job.id}/edit`}
            className="flex items-center justify-between gap-4 bg-ink text-paper-hi rounded-lg px-5 sm:px-6 py-5 sm:py-6 hover:bg-sunken-soft transition-colors"
          >
            <div>
              <div className="font-display tracking-label uppercase text-[11px] opacity-60">
                Fine-tune
              </div>
              <div className="font-display font-semibold text-2xl sm:text-3xl mt-0.5">
                Open Editor →
              </div>
            </div>
          </Link>
        </section>
      )}

      {isFailed && (
        <section className="mt-6">
          <ChunkyButton variant="secondary" size="md">
            <Link to="/">Try a new upload</Link>
          </ChunkyButton>
        </section>
      )}
    </main>
  );
}

function BigPercent({
  value,
  status,
}: {
  value: number;
  status: Job["status"];
}) {
  const isDone = status === "done";
  const tone = status === "failed" ? "danger" : "hot";
  const v = isDone ? 100 : Math.round(value);
  return (
    <div className="bg-ink text-paper-hi rounded-lg p-5 sm:p-6 flex flex-col justify-between min-h-[180px]">
      <div className="flex items-center justify-between">
        <span className="font-display tracking-label uppercase text-[11px] text-paper-hi/60">
          Progress
        </span>
        <span
          className={[
            "font-mono text-[10px] tracking-label uppercase",
            status === "failed" ? "text-danger" : "text-hot",
          ].join(" ")}
        >
          ● {status.toUpperCase()}
        </span>
      </div>
      <div
        className="font-display font-semibold leading-none tabular"
        style={{ fontSize: "clamp(72px, 14vw, 168px)", letterSpacing: "-0.04em" }}
      >
        <span className={tone === "danger" ? "text-danger" : "text-hot"}>
          {v}
        </span>
        <span className="text-paper-hi/40 text-[0.5em] ml-1">%</span>
      </div>
      <div className="h-1.5 bg-sunken-soft rounded-full overflow-hidden">
        <div
          className={[
            "h-full transition-all",
            tone === "danger" ? "bg-danger" : "bg-hot",
          ].join(" ")}
          style={{ width: `${v}%` }}
        />
      </div>
    </div>
  );
}

function StageDiagram({
  stage,
  status,
}: {
  stage: string;
  status: Job["status"];
}) {
  const idx = (() => {
    if (status === "done") return STAGES.length - 1;
    if (status === "failed") return STAGES.findIndex((s) => s.key === stage);
    return STAGES.findIndex((s) => s.key === stage);
  })();

  return (
    <div className="bg-paper-hi border border-rule rounded-lg p-5 sm:p-6 flex flex-col justify-between min-h-[180px]">
      <span className="label mb-3">Pipeline</span>
      <ol className="grid grid-cols-5 gap-2 sm:gap-3 items-end">
        {STAGES.map((s, i) => {
          const completed = i < idx || (status === "done" && i === STAGES.length - 1);
          const active = i === idx && status !== "done" && status !== "failed";
          const failed = status === "failed" && i === idx;
          return (
            <li key={s.key} className="flex flex-col items-center gap-1.5">
              <span
                className={[
                  "font-mono text-[10px] tabular tracking-label uppercase leading-none",
                  failed
                    ? "text-danger"
                    : completed
                      ? "text-ink-2"
                      : active
                        ? "text-hot"
                        : "text-ink-3",
                ].join(" ")}
              >
                {String(i + 1).padStart(2, "0")}
              </span>
              <span
                className={[
                  "block w-full h-12 sm:h-14 rounded-sm border",
                  failed
                    ? "bg-danger/10 border-danger"
                    : completed
                      ? "bg-ink border-ink"
                      : active
                        ? "bg-hot border-hot animate-pulse"
                        : "bg-paper-deep border-rule",
                ].join(" ")}
              />
              <span
                className={[
                  "font-display tracking-label uppercase text-[10px] sm:text-[11px] leading-none",
                  failed
                    ? "text-danger"
                    : completed
                      ? "text-ink"
                      : active
                        ? "text-hot"
                        : "text-ink-3",
                ].join(" ")}
              >
                {s.label}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Timing({ job, isActive }: { job: Job; isActive: boolean }) {
  const elapsed = useElapsedSeconds(job.started_at, job.finished_at);
  const showElapsed = isActive && job.started_at !== null;
  const showEta = isActive && job.progress_eta_s != null && job.progress_eta_s > 0;
  return (
    <div className="flex items-center gap-3 font-mono text-[11px] tabular tracking-label uppercase text-ink-2">
      {showElapsed && <span>Elapsed {formatDuration(elapsed)}</span>}
      {showEta && <span>ETA {formatDuration(job.progress_eta_s!)}</span>}
    </div>
  );
}

function StatusBadge({ status }: { status: Job["status"] }) {
  const map: Record<string, { bg: string; text: string }> = {
    done: { bg: "bg-success/15 text-success border-success/30", text: "DONE" },
    failed: { bg: "bg-danger/15 text-danger border-danger/30", text: "FAILED" },
    queued: { bg: "bg-paper-deep text-ink-2 border-rule", text: "QUEUED" },
    analyzing: { bg: "bg-hot/15 text-hot border-hot/30", text: "ANALYZING" },
    syncing: { bg: "bg-hot/15 text-hot border-hot/30", text: "SYNCING" },
    rendering: { bg: "bg-hot/15 text-hot border-hot/30", text: "RENDERING" },
    expired: { bg: "bg-paper-deep text-ink-3 border-rule", text: "EXPIRED" },
  };
  const it = map[status] || map.queued;
  return (
    <span
      className={[
        "inline-flex items-center h-6 px-2 rounded-sm border font-mono text-[10px] tracking-label uppercase shrink-0",
        it.bg,
      ].join(" ")}
    >
      {it.text}
    </span>
  );
}

function stageLabel(s: string): string {
  const found = STAGES.find((x) => x.key === s);
  return found ? found.label : s;
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

function Banner({
  kind,
  text,
  className = "",
}: {
  kind: "info" | "warn" | "error";
  text: string;
  className?: string;
}) {
  const colors =
    kind === "error"
      ? "bg-danger/10 border-danger text-danger"
      : kind === "warn"
        ? "bg-warn/10 border-warn text-ink"
        : "bg-paper-deep border-rule text-ink-2";
  return (
    <div
      className={`rounded-md border-l-2 px-4 py-3 font-mono text-sm ${colors} ${className}`}
    >
      {text}
    </div>
  );
}
