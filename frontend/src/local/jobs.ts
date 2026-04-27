/**
 * Local-job lifecycle. Replaces the backend job API.
 *
 * Flow:
 *   1. `createJob(videoFile, audioFile, title)` writes both files to OPFS,
 *      records a fresh `LocalJob` in IndexedDB (status=queued), and returns
 *      its id. Sync is launched immediately as a fire-and-forget task; UI
 *      should subscribe to job events to show progress.
 *   2. `runQuickRender(jobId, opts)` produces an MP4 in OPFS using the
 *      sync result + user offset/drift overrides.
 *   3. `runEditRender(jobId, editSpec)` does the same for the full edit.
 *
 * Progress is dispatched on a global EventTarget so multiple components
 * can subscribe (JobPage, History) without coupling to the orchestrator.
 */

import { jobsDb, type JobProgress, type LocalJob, type SyncResult } from "../storage/jobs-db";
import { opfs } from "../storage/opfs";
import { syncAudio } from "./sync";
import { quickRender } from "./render/quick";
import { editRender, type Segment } from "./render/edit";
import { decodeAudioToMonoPcm } from "./codec";
import { computeEnergyCurves } from "./render/energy";
import type { TextOverlay } from "./render/ass-builder";
import type { Visualizer } from "./render/visualizer/types";
import {
  installRenderUnloadGuard,
  pruneIfQuotaTight,
  removeRenderUnloadGuard,
  requestPersistentStorage,
} from "./lifecycle";

const VIDEO_NAME = "video";
const AUDIO_NAME = "audio";
const OUTPUT_NAME = "output.mp4";

export const jobEvents = new EventTarget();

type JobEvent = CustomEvent<{ jobId: string; job: LocalJob }>;

function emitJobUpdate(job: LocalJob): void {
  jobEvents.dispatchEvent(
    new CustomEvent("update", { detail: { jobId: job.id, job } }) as JobEvent,
  );
}

function videoPath(jobId: string, ext: string): string {
  return `jobs/${jobId}/${VIDEO_NAME}.${ext}`;
}
function audioPath(jobId: string, ext: string): string {
  return `jobs/${jobId}/${AUDIO_NAME}.${ext}`;
}
function outputPath(jobId: string): string {
  return `jobs/${jobId}/${OUTPUT_NAME}`;
}

function generateJobId(): string {
  // 12 hex chars from cryptographically random bytes; same density as a
  // UUID's prefix and avoids the dashes when used in URLs.
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fileExtension(file: File, fallback: string): string {
  const dot = file.name.lastIndexOf(".");
  if (dot < 0 || dot === file.name.length - 1) return fallback;
  const ext = file.name.slice(dot + 1).toLowerCase();
  return /^[a-z0-9]{1,8}$/i.test(ext) ? ext : fallback;
}

interface CreateJobOptions {
  /** Optional title; falls back to the video file name. */
  title?: string | null;
}

/**
 * Persists the input files in OPFS, registers the job, and kicks off sync
 * asynchronously. Returns immediately with the new job id; subscribe to
 * `jobEvents` for status updates.
 */
export async function createJob(
  videoFile: File,
  audioFile: File,
  options: CreateJobOptions = {},
): Promise<string> {
  // Best-effort housekeeping before we commit big new files: ask for
  // persistent storage (so the browser doesn't evict OPFS under pressure)
  // and prune old jobs if we're close to the quota.
  void requestPersistentStorage();
  await pruneIfQuotaTight().catch(() => undefined);

  const jobId = generateJobId();
  const videoExt = fileExtension(videoFile, "mp4");
  const audioExt = fileExtension(audioFile, "wav");

  await opfs.writeFile(videoPath(jobId, videoExt), videoFile);
  await opfs.writeFile(audioPath(jobId, audioExt), audioFile);

  const job: LocalJob = {
    id: jobId,
    title: options.title ?? videoFile.name,
    videoFilename: videoFile.name,
    audioFilename: audioFile.name,
    status: "queued",
    progress: { pct: 0, stage: "queued" },
    hasOutput: false,
    createdAt: Date.now(),
  };
  await jobsDb.saveJob(job);
  emitJobUpdate(job);

  // Kick off sync without awaiting — UI subscribes for results.
  void runSync(jobId, videoExt, audioExt).catch(async (err) => {
    const failed = await jobsDb.updateJob(jobId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
      progress: { pct: 100, stage: "failed" },
    });
    emitJobUpdate(failed);
  });

  return jobId;
}

async function reportProgress(
  jobId: string,
  partial: Partial<JobProgress>,
  status?: LocalJob["status"],
): Promise<void> {
  const cur = await jobsDb.getJob(jobId);
  if (!cur) return;
  const next: JobProgress = { ...cur.progress, ...partial };
  const updated = await jobsDb.updateJob(jobId, {
    progress: next,
    ...(status ? { status } : {}),
  });
  emitJobUpdate(updated);
}

async function runSync(
  jobId: string,
  videoExt: string,
  audioExt: string,
): Promise<void> {
  await reportProgress(jobId, { pct: 5, stage: "loading" }, "syncing");

  const videoFile = await opfs.readFile(videoPath(jobId, videoExt));
  const audioFile = await opfs.readFile(audioPath(jobId, audioExt));

  await reportProgress(jobId, { pct: 20, stage: "decoding-video-audio" });
  const videoMonoPcm = await decodeAudioToMonoPcm(videoFile, 22050);

  await reportProgress(jobId, { pct: 50, stage: "decoding-studio-audio" });
  const studioMonoPcm = await decodeAudioToMonoPcm(audioFile, 22050);

  await reportProgress(jobId, { pct: 70, stage: "syncing" });
  const result = await syncAudio({
    refSource: videoMonoPcm.pcm,
    querySource: studioMonoPcm.pcm,
  });

  const sync: SyncResult = {
    offsetMs: result.offsetMs,
    driftRatio: result.driftRatio,
    confidence: result.confidence,
    warning: result.warning ?? undefined,
  };

  // Probe video for duration / size if possible — best-effort.
  let durationS: number | undefined;
  try {
    const { demuxVideoTrack } = await import("./codec/webcodecs/demux");
    const v = await demuxVideoTrack(videoFile);
    if (v) durationS = v.info.durationS;
  } catch {
    // ignore — duration is nice-to-have
  }

  const updated = await jobsDb.updateJob(jobId, {
    sync,
    durationS,
    status: "synced",
    progress: { pct: 100, stage: "synced" },
    finishedAt: Date.now(),
  });
  emitJobUpdate(updated);
}

interface QuickRenderInput {
  /** User offset override added on top of the algorithm's offsetMs. */
  offsetOverrideMs?: number;
}

export async function runQuickRender(
  jobId: string,
  opts: QuickRenderInput = {},
): Promise<void> {
  const job = await jobsDb.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!job.sync) throw new Error("Cannot render before sync completes.");

  installRenderUnloadGuard(jobId);
  try {
    await reportProgress(jobId, { pct: 5, stage: "render-prep" }, "rendering");

    const videoExt = fileExtension(new File([], job.videoFilename), "mp4");
    const audioExt = fileExtension(new File([], job.audioFilename), "wav");
    const videoFile = await opfs.readFile(videoPath(jobId, videoExt));
    const audioFile = await opfs.readFile(audioPath(jobId, audioExt));

    await reportProgress(jobId, { pct: 15, stage: "encoding" });
    const totalOffsetMs = job.sync.offsetMs + (opts.offsetOverrideMs ?? 0);
    const result = await quickRender({
      videoFile,
      audioFile,
      offsetMs: totalOffsetMs,
      driftRatio: job.sync.driftRatio,
    });

    await reportProgress(jobId, { pct: 90, stage: "writing" });
    await opfs.writeFile(outputPath(jobId), result.output);

    const updated = await jobsDb.updateJob(jobId, {
      status: "rendered",
      hasOutput: true,
      outputBytes: result.output.byteLength,
      progress: { pct: 100, stage: "rendered" },
      finishedAt: Date.now(),
    });
    emitJobUpdate(updated);
  } finally {
    removeRenderUnloadGuard(jobId);
  }
}

export interface EditSpecLocal {
  segments: Segment[];
  overlays: TextOverlay[];
  offsetOverrideMs?: number;
  /**
   * Subset of visualizers to add — built lazily inside runEditRender from
   * the audio PCM + energy curves. The UI sends a small descriptor; we
   * expand it here.
   */
  visualizers?: VisualizerDescriptor[];
}

export type VisualizerDescriptor =
  | { type: "showwaves" }
  | { type: "showfreqs" };

export async function runEditRender(
  jobId: string,
  spec: EditSpecLocal,
): Promise<void> {
  const job = await jobsDb.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!job.sync) throw new Error("Cannot render before sync completes.");

  installRenderUnloadGuard(jobId);
  try {
    await reportProgress(jobId, { pct: 5, stage: "render-prep" }, "rendering");

    const videoExt = fileExtension(new File([], job.videoFilename), "mp4");
    const audioExt = fileExtension(new File([], job.audioFilename), "wav");
    const videoFile = await opfs.readFile(videoPath(jobId, videoExt));
    const audioFile = await opfs.readFile(audioPath(jobId, audioExt));

    // For visualizers + reactive overlays we need PCM + energy curves up front.
    let pcm: Float32Array | null = null;
    let energy: ReturnType<typeof computeEnergyCurves> | null = null;
    const needsPcm =
      (spec.visualizers && spec.visualizers.length > 0) ||
      spec.overlays.some((o) => o.reactiveBand);
    if (needsPcm) {
      await reportProgress(jobId, { pct: 15, stage: "energy-curves" });
      const decoded = await decodeAudioToMonoPcm(audioFile, 22050);
      pcm = decoded.pcm;
      energy = computeEnergyCurves(pcm, 22050, 30);
    }

    const visualizers: Visualizer[] = [];
    if (spec.visualizers && pcm && energy) {
      const { ShowwavesVisualizer } = await import("./render/visualizer/showwaves");
      const { ShowfreqsVisualizer } = await import("./render/visualizer/showfreqs");
      for (const desc of spec.visualizers) {
        if (desc.type === "showwaves") {
          visualizers.push(new ShowwavesVisualizer({ pcm, sampleRate: 22050 }));
        } else if (desc.type === "showfreqs") {
          visualizers.push(new ShowfreqsVisualizer({ energy }));
        }
      }
    }

    await reportProgress(jobId, { pct: 30, stage: "encoding" });
    const totalOffsetMs = job.sync.offsetMs + (spec.offsetOverrideMs ?? 0);
    const result = await editRender({
      videoFile,
      audioFile,
      segments: spec.segments,
      overlays: spec.overlays,
      energy,
      visualizers,
      offsetMs: totalOffsetMs,
      driftRatio: job.sync.driftRatio,
    });

    await reportProgress(jobId, { pct: 90, stage: "writing" });
    await opfs.writeFile(outputPath(jobId), result.output);

    const updated = await jobsDb.updateJob(jobId, {
      status: "rendered",
      hasOutput: true,
      outputBytes: result.output.byteLength,
      progress: { pct: 100, stage: "rendered" },
      finishedAt: Date.now(),
      editSpec: spec,
    });
    emitJobUpdate(updated);
  } finally {
    removeRenderUnloadGuard(jobId);
  }
}

/**
 * Resolve OPFS-backed object URLs for the editor / preview UI. Caller is
 * responsible for `URL.revokeObjectURL` when finished.
 */
export async function resolveJobAssetUrl(
  jobId: string,
  kind: "video" | "audio" | "output",
): Promise<string | null> {
  if (kind === "output") {
    const exists = await opfs.exists(outputPath(jobId));
    if (!exists) return null;
    return opfs.objectUrl(outputPath(jobId));
  }
  const job = await jobsDb.getJob(jobId);
  if (!job) return null;
  const ext = fileExtension(
    new File([], kind === "video" ? job.videoFilename : job.audioFilename),
    kind === "video" ? "mp4" : "wav",
  );
  const path = kind === "video" ? videoPath(jobId, ext) : audioPath(jobId, ext);
  if (!(await opfs.exists(path))) return null;
  return opfs.objectUrl(path);
}

export async function deleteJob(jobId: string): Promise<void> {
  await opfs.deletePath(`jobs/${jobId}`);
  await jobsDb.deleteJob(jobId);
}

export { jobsDb };
export type { LocalJob, SyncResult, JobProgress, Segment, TextOverlay };
