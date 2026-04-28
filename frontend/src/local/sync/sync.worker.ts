/**
 * Sync Worker — runs the WASM matcher off the main thread.
 *
 * Why: `syncAudioPcm` is CPU-heavy (~hundreds of ms to seconds for a few
 * minutes of audio). On the main thread it freezes the UI, which used to
 * be acceptable when sync only ran upfront on the upload screen, but with
 * sync moving into the editor (B-roll add, cam re-prep) the editor must
 * stay interactive. Running here on a DedicatedWorker is the cleanest fix.
 *
 * Decoding (WebAudio → mono PCM) stays on the main thread because
 * OfflineAudioContext has Safari-side caveats inside workers; we transfer
 * the resulting Float32Array buffers into the worker zero-copy instead.
 */

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

export type SyncWorkerRequest = {
  type: "match";
  refPcm: Float32Array;
  queryPcm: Float32Array;
  sampleRate: number;
};

export type SyncWorkerResponse =
  | { type: "result"; result: RawSyncResult }
  | { type: "error"; message: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

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

ctx.addEventListener("message", async (e: MessageEvent<SyncWorkerRequest>) => {
  const msg = e.data;
  if (msg.type !== "match") return;
  try {
    const wasm = await loadWasm();
    const result = wasm.syncAudioPcm(
      msg.refPcm,
      msg.queryPcm,
      msg.sampleRate,
    ) as RawSyncResult;
    const evt: SyncWorkerResponse = { type: "result", result };
    ctx.postMessage(evt);
  } catch (err) {
    const evt: SyncWorkerResponse = {
      type: "error",
      message: err instanceof Error ? err.message : String(err),
    };
    ctx.postMessage(evt);
  }
});
