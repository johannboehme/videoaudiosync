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
import {
  decodeStudioAudioInterleaved,
  type Segment,
} from "./render/edit";
import type {
  EditWorkerEvent,
  EditWorkerInput,
  EditWorkerMessage,
  VisualizerWorkerDescriptor,
} from "./render/edit.worker";
import { decodeAudioToMonoPcm } from "./codec";
import { computeEnergyCurves } from "./render/energy";
import type { TextOverlay } from "./render/ass-builder";
import {
  installRenderUnloadGuard,
  pruneIfQuotaTight,
  removeRenderUnloadGuard,
  requestPersistentStorage,
} from "./lifecycle";
import { emitJobUpdate, jobEvents } from "./jobs-events";

export { jobEvents };

const VIDEO_NAME = "video";
const AUDIO_NAME = "audio";
const OUTPUT_NAME = "output.mp4";

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

/**
 * Mark a job as failed and emit an update event. Best-effort — if the
 * row no longer exists (e.g. user deleted it during render), we swallow.
 */
async function markFailed(jobId: string, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  try {
    const updated = await jobsDb.updateJob(jobId, {
      status: "failed",
      error: message,
      progress: { pct: 100, stage: "failed" },
      finishedAt: Date.now(),
    });
    emitJobUpdate(updated);
  } catch {
    // ignore — likely deleted
  }
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
  } catch (err) {
    // Crucial: without this the job stays stuck in "rendering" status
    // forever and the JobPage shows no recovery actions.
    await markFailed(jobId, err);
    throw err;
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

/**
 * Tracks renders that are currently running so cancelEditRender can
 * terminate the underlying worker. One entry per active job; renders
 * for different jobs run concurrently with their own workers.
 */
const activeRenders = new Map<string, Worker>();

/**
 * Start the edit-render. Returns a promise that resolves when the worker
 * reports `done` or rejects on `error`. The caller is free to ignore the
 * promise — the function emits jobEvents along the way, so the UI can
 * subscribe through that channel instead.
 *
 * Cancel by calling `cancelEditRender(jobId)`.
 */
export async function runEditRender(
  jobId: string,
  spec: EditSpecLocal,
): Promise<void> {
  const job = await jobsDb.getJob(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  if (!job.sync) throw new Error("Cannot render before sync completes.");
  if (activeRenders.has(jobId)) {
    throw new Error("Render already in progress for this job.");
  }

  installRenderUnloadGuard(jobId);
  let workerOwned: Worker | null = null;
  try {
    await reportProgress(jobId, { pct: 5, stage: "render-prep" }, "rendering");

    const videoExt = fileExtension(new File([], job.videoFilename), "mp4");
    const audioExt = fileExtension(new File([], job.audioFilename), "wav");
    const videoOpfsPath = videoPath(jobId, videoExt);
    const audioFile = await opfs.readFile(audioPath(jobId, audioExt));

    // Audio decode + energy curves run on the main thread because
    // AudioContext.decodeAudioData isn't available in workers. Both are
    // fast (a few seconds for a 3-min file) and the produced Float32Arrays
    // are transferred zero-copy into the worker.
    await reportProgress(jobId, { pct: 10, stage: "audio-decode" });
    const audio = await decodeStudioAudioInterleaved(audioFile);

    let monoPcm: Float32Array | null = null;
    let energy: ReturnType<typeof computeEnergyCurves> | null = null;
    const needsPcm =
      (spec.visualizers && spec.visualizers.length > 0) ||
      spec.overlays.some((o) => o.reactiveBand);
    if (needsPcm) {
      await reportProgress(jobId, { pct: 18, stage: "energy-curves" });
      const decoded = await decodeAudioToMonoPcm(audioFile, 22050);
      monoPcm = decoded.pcm;
      energy = computeEnergyCurves(monoPcm, 22050, 30);
    }

    const visualizerDescs: VisualizerWorkerDescriptor[] = [];
    if (spec.visualizers && monoPcm && energy) {
      for (const desc of spec.visualizers) {
        if (desc.type === "showwaves") {
          visualizerDescs.push({ type: "showwaves", pcm: monoPcm, sampleRate: 22050 });
        } else if (desc.type === "showfreqs") {
          visualizerDescs.push({ type: "showfreqs", energy });
        }
      }
    }

    await reportProgress(jobId, { pct: 25, stage: "encoding" });
    const totalOffsetMs = job.sync.offsetMs + (spec.offsetOverrideMs ?? 0);

    const workerInput: EditWorkerInput = {
      videoPath: videoOpfsPath,
      outputPath: outputPath(jobId),
      audioPcm: audio,
      segments: spec.segments,
      overlays: spec.overlays,
      visualizers: visualizerDescs,
      energy,
      offsetMs: totalOffsetMs,
      driftRatio: job.sync.driftRatio,
    };

    // Collect transferables: every Float32Array buffer we hand to the
    // worker is detached on the main side, freeing memory immediately.
    const transferables: Transferable[] = [audio.pcm.buffer];
    for (const d of visualizerDescs) {
      if (d.type === "showwaves") transferables.push(d.pcm.buffer);
    }

    const worker = new Worker(new URL("./render/edit.worker.ts", import.meta.url), {
      type: "module",
    });
    workerOwned = worker;
    activeRenders.set(jobId, worker);

    let lastDispatchedPct = 25;
    await new Promise<void>((resolve, reject) => {
      worker.addEventListener("message", (e: MessageEvent<EditWorkerEvent>) => {
        const msg = e.data;
        if (msg.type === "progress") {
          const p = msg.progress;
          if (p.stage !== "video-encode" || p.framesTotal <= 0) return;
          const pct = 25 + Math.floor((p.framesDone / p.framesTotal) * 65);
          if (pct === lastDispatchedPct) return;
          lastDispatchedPct = pct;
          void reportProgress(jobId, {
            pct: Math.min(89, pct),
            stage: "encoding",
            framesDone: p.framesDone,
            framesTotal: p.framesTotal,
          });
        } else if (msg.type === "done") {
          resolve();
        } else if (msg.type === "error") {
          reject(new Error(msg.message));
        }
      });
      worker.addEventListener("error", (e) => {
        reject(new Error(e.message || "Render worker crashed"));
      });
      const startMsg: EditWorkerMessage = { type: "start", input: workerInput };
      worker.postMessage(startMsg, transferables);
    });

    await reportProgress(jobId, { pct: 95, stage: "writing" });
    const outputFile = await opfs.readFile(outputPath(jobId));
    const outputBytes = outputFile.size;

    const updated = await jobsDb.updateJob(jobId, {
      status: "rendered",
      hasOutput: true,
      outputBytes,
      progress: { pct: 100, stage: "rendered" },
      finishedAt: Date.now(),
      editSpec: spec,
    });
    emitJobUpdate(updated);
  } catch (err) {
    await markFailed(jobId, err);
    throw err;
  } finally {
    if (workerOwned) {
      workerOwned.terminate();
      activeRenders.delete(jobId);
    }
    removeRenderUnloadGuard(jobId);
  }
}

/**
 * Cancel an in-progress edit render. Hard-terminates the worker, deletes
 * the partial OPFS output, and marks the job as failed with a "cancelled"
 * sentinel so the UI can distinguish it from a real failure.
 *
 * Safe to call when no render is active for the given job — it's a no-op.
 */
export async function cancelEditRender(jobId: string): Promise<void> {
  const worker = activeRenders.get(jobId);
  if (!worker) return;
  worker.terminate();
  activeRenders.delete(jobId);
  // Remove the half-written output file so a future render isn't fooled
  // by leftovers. Best-effort — the file may not exist yet.
  await opfs.deleteFile(outputPath(jobId)).catch(() => undefined);
  try {
    const updated = await jobsDb.updateJob(jobId, {
      status: "failed",
      error: "cancelled",
      progress: { pct: 100, stage: "cancelled" },
      finishedAt: Date.now(),
    });
    emitJobUpdate(updated);
  } catch {
    // ignore — job may have been deleted already
  }
  removeRenderUnloadGuard(jobId);
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
