/**
 * Public sync API. Loads the WASM lazily on first call and runs the algorithm
 * inline (Phase 2 ships without an explicit Web Worker; the WASM is fast
 * enough on M1 that the main thread stalls under 1s for 90s of audio. We
 * move it into a Worker if profiling shows a UX problem in Phase 5).
 */

import { decodeAudioToMonoPcm } from "../codec/index";

export interface MatchCandidate {
  /** Offset (master-timeline ms) at which this candidate would align the cam. */
  offsetMs: number;
  /** Sample-level Pearson correlation, ~0..1 (higher = more confident). */
  confidence: number;
  /** Number of sample frames used to compute the score (overlap window). */
  overlapFrames: number;
}

export interface SyncResult {
  offsetMs: number;
  confidence: number;
  driftRatio: number;
  method: string;
  warning: string | null;
  /** Top-K alternative offsets ranked by sample-level confidence.
   *  candidates[0] mirrors offsetMs/confidence (the chosen primary). */
  candidates: MatchCandidate[];
}

let wasmInitialized: Promise<typeof import("../../../wasm/sync-core/pkg/sync_core.js")> | null = null;

async function loadWasm() {
  if (!wasmInitialized) {
    wasmInitialized = (async () => {
      const mod = await import("../../../wasm/sync-core/pkg/sync_core.js");
      await mod.default();
      return mod;
    })();
  }
  return wasmInitialized;
}

const TARGET_SR = 22050;

export interface SyncInput {
  /** Reference audio: typically the audio extracted from the phone-recorded video. */
  refSource: Blob | ArrayBuffer | Float32Array;
  /** Query audio: typically the clean studio recording. */
  querySource: Blob | ArrayBuffer | Float32Array;
}

async function ensurePcm(
  source: Blob | ArrayBuffer | Float32Array,
): Promise<Float32Array> {
  if (source instanceof Float32Array) return source;
  const decoded = await decodeAudioToMonoPcm(source, TARGET_SR);
  return decoded.pcm;
}

interface RawCandidate {
  offset_ms: number;
  confidence: number;
  overlap_frames: number;
}

interface RawSyncResult {
  offset_ms: number;
  confidence: number;
  drift_ratio: number;
  method: string;
  warning: string | null;
  candidates?: RawCandidate[];
}

/** Pure mapping helper — exported so it can be unit-tested without loading
 *  the WASM. The WASM returns snake_case to mirror Rust serde conventions;
 *  we expose camelCase to the rest of the codebase. */
export function mapWasmResult(raw: RawSyncResult): SyncResult {
  return {
    offsetMs: raw.offset_ms,
    confidence: raw.confidence,
    driftRatio: raw.drift_ratio,
    method: raw.method,
    warning: raw.warning,
    candidates: (raw.candidates ?? []).map((c) => ({
      offsetMs: c.offset_ms,
      confidence: c.confidence,
      overlapFrames: c.overlap_frames,
    })),
  };
}

export async function syncAudio(input: SyncInput): Promise<SyncResult> {
  const [refPcm, queryPcm] = await Promise.all([
    ensurePcm(input.refSource),
    ensurePcm(input.querySource),
  ]);
  const wasm = await loadWasm();
  const raw = wasm.syncAudioPcm(refPcm, queryPcm, TARGET_SR) as RawSyncResult;
  return mapWasmResult(raw);
}
