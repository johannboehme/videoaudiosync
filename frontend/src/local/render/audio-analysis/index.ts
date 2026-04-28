/**
 * Public audio-analysis API: cache-or-compute.
 *
 * The analysis itself runs in `audio-analysis.worker.ts` (off main thread).
 * Results are cached per job in IDB (`audio-analysis` store, keyed by jobId).
 *
 * - First call for a job: spawns the worker, computes, persists, resolves.
 * - Subsequent calls: returns the cached `AudioAnalysis` directly.
 * - `recomputeAnalysis(jobId, ...)` forces a fresh compute (e.g. after the
 *   user replaces the master audio). Currently not wired into the UI but
 *   kept here so the cache invalidation strategy is explicit.
 */
import { jobsDb } from "../../../storage/jobs-db";
import type { AudioAnalysis } from "./types";

export type { AudioAnalysis } from "./types";

/** Lazy-mounted singleton worker. Spawned on first analysis request.
 *  Uses Vite's `new Worker(new URL(...), { type: "module" })` syntax that
 *  the rest of the codebase already relies on (see jobs.ts:530). */
let worker: Worker | null = null;
let nextRequestId = 1;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(
      new URL("./audio-analysis.worker.ts", import.meta.url),
      { type: "module" },
    );
  }
  return worker;
}

interface WorkerResult {
  type: "result";
  id: number;
  analysis: AudioAnalysis;
}

interface WorkerError {
  type: "error";
  id: number;
  message: string;
}

type WorkerReply = WorkerResult | WorkerError;

async function runAnalyzeInWorker(
  pcm: Float32Array,
  sampleRate: number,
): Promise<AudioAnalysis> {
  const w = getWorker();
  const id = nextRequestId++;
  return new Promise<AudioAnalysis>((resolve, reject) => {
    const onMessage = (e: MessageEvent<WorkerReply>) => {
      if (e.data.id !== id) return;
      w.removeEventListener("message", onMessage);
      if (e.data.type === "result") resolve(e.data.analysis);
      else reject(new Error(e.data.message));
    };
    w.addEventListener("message", onMessage);
    w.postMessage({ type: "analyze", id, pcm, sampleRate });
  });
}

export async function getOrComputeAnalysis(
  jobId: string,
  pcm: Float32Array,
  sampleRate: number,
): Promise<AudioAnalysis> {
  const cached = await jobsDb.getAudioAnalysis<AudioAnalysis>(jobId);
  if (cached && cached.version === 1 && cached.sampleRate === sampleRate) {
    return cached;
  }
  const fresh = await runAnalyzeInWorker(pcm, sampleRate);
  await jobsDb.saveAudioAnalysis(jobId, fresh);
  return fresh;
}

export async function recomputeAnalysis(
  jobId: string,
  pcm: Float32Array,
  sampleRate: number,
): Promise<AudioAnalysis> {
  const fresh = await runAnalyzeInWorker(pcm, sampleRate);
  await jobsDb.saveAudioAnalysis(jobId, fresh);
  return fresh;
}

export async function getCachedAnalysis(
  jobId: string,
): Promise<AudioAnalysis | undefined> {
  return jobsDb.getAudioAnalysis<AudioAnalysis>(jobId);
}
