/**
 * Browser-Capability-Detection.
 *
 * Synchroner Teil (`detectCapabilities`) prüft nur API-Vorhandensein — keine
 * Codec-Spezifika, weil das ein async-Call ist (`isConfigSupported`). Codec-
 * Detection lebt in `codec/resolve.ts` und passiert pro Datei.
 *
 * `meetsMinRequirements` definiert die App-weite Min-Anforderung. Browser, die
 * darunter liegen, sehen die Error-Page. Mit den Min-Anforderungen kann die App
 * IMMER lokal rendern: entweder via WebCodecs (Chrome/Safari) oder via
 * ffmpeg.wasm (Firefox/Safari ohne WebCodecs-Encoder).
 */

export interface Capabilities {
  webAssembly: boolean;
  sharedArrayBuffer: boolean;
  /** True nur wenn der Server COOP/COEP-Header gesetzt hat. */
  crossOriginIsolated: boolean;
  /** Origin Private File System für lokale, persistente Files. */
  opfs: boolean;
  audioDecoder: boolean;
  videoDecoder: boolean;
  audioEncoder: boolean;
  videoEncoder: boolean;
  /** showSaveFilePicker. Falls fehlend, fallen wir auf `<a download>` zurück. */
  fileSystemAccess: boolean;
}

export interface MinRequirementsResult {
  ok: boolean;
  missing: ReadonlyArray<keyof Capabilities>;
}

/**
 * Min-Anforderungen für die App. Begründung im Plan-File:
 * - WebAssembly: Sync-Algorithmus (sync-core) und ffmpeg.wasm-Fallback.
 * - SharedArrayBuffer + crossOriginIsolated: WASM-Threads (Performance).
 * - OPFS: lokale, persistente Files ohne 4-GB-Memory-Limit.
 *
 * WebCodecs ist NICHT min-required — wir haben den ffmpeg.wasm-Fallback.
 * fileSystemAccess ist NICHT min-required — `<a download>` reicht.
 */
const MIN_REQUIRED: ReadonlyArray<keyof Capabilities> = [
  "webAssembly",
  "sharedArrayBuffer",
  "crossOriginIsolated",
  "opfs",
];

export function detectCapabilities(): Capabilities {
  const w = globalThis as typeof globalThis & {
    SharedArrayBuffer?: unknown;
    AudioDecoder?: unknown;
    VideoDecoder?: unknown;
    AudioEncoder?: unknown;
    VideoEncoder?: unknown;
    showSaveFilePicker?: unknown;
    crossOriginIsolated?: boolean;
  };

  return {
    webAssembly: typeof WebAssembly !== "undefined",
    sharedArrayBuffer: typeof w.SharedArrayBuffer !== "undefined",
    crossOriginIsolated: w.crossOriginIsolated === true,
    opfs:
      typeof navigator !== "undefined" &&
      typeof navigator.storage !== "undefined" &&
      typeof navigator.storage.getDirectory === "function",
    audioDecoder: typeof w.AudioDecoder !== "undefined",
    videoDecoder: typeof w.VideoDecoder !== "undefined",
    audioEncoder: typeof w.AudioEncoder !== "undefined",
    videoEncoder: typeof w.VideoEncoder !== "undefined",
    fileSystemAccess: typeof w.showSaveFilePicker === "function",
  };
}

export function meetsMinRequirements(caps: Capabilities): MinRequirementsResult {
  const missing = MIN_REQUIRED.filter((key) => caps[key] !== true);
  return {
    ok: missing.length === 0,
    missing,
  };
}

/**
 * Menschenlesbares Label für jede Capability — verwendet auf der Error-Page
 * und im Settings-Capability-Report.
 */
export function describeCapability(key: keyof Capabilities): string {
  switch (key) {
    case "webAssembly":
      return "WebAssembly";
    case "sharedArrayBuffer":
      return "SharedArrayBuffer";
    case "crossOriginIsolated":
      return "Cross-Origin Isolation (COOP/COEP)";
    case "opfs":
      return "Origin Private File System";
    case "audioDecoder":
      return "WebCodecs AudioDecoder";
    case "videoDecoder":
      return "WebCodecs VideoDecoder";
    case "audioEncoder":
      return "WebCodecs AudioEncoder";
    case "videoEncoder":
      return "WebCodecs VideoEncoder";
    case "fileSystemAccess":
      return "File System Access API";
  }
}
