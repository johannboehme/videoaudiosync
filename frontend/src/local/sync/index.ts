/**
 * Public sync API. Loads the WASM lazily on first call and runs the algorithm
 * inline (Phase 2 ships without an explicit Web Worker; the WASM is fast
 * enough on M1 that the main thread stalls under 1s for 90s of audio. We
 * move it into a Worker if profiling shows a UX problem in Phase 5).
 */

import { decodeAudioToMonoPcm } from "../codec/index";

export interface SyncResult {
  offsetMs: number;
  confidence: number;
  driftRatio: number;
  method: string;
  warning: string | null;
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

function snakeToCamel(raw: {
  offset_ms: number;
  confidence: number;
  drift_ratio: number;
  method: string;
  warning: string | null;
}): SyncResult {
  return {
    offsetMs: raw.offset_ms,
    confidence: raw.confidence,
    driftRatio: raw.drift_ratio,
    method: raw.method,
    warning: raw.warning,
  };
}

export async function syncAudio(input: SyncInput): Promise<SyncResult> {
  const [refPcm, queryPcm] = await Promise.all([
    ensurePcm(input.refSource),
    ensurePcm(input.querySource),
  ]);
  const wasm = await loadWasm();
  const raw = wasm.syncAudioPcm(refPcm, queryPcm, TARGET_SR) as Parameters<typeof snakeToCamel>[0];
  return snakeToCamel(raw);
}
