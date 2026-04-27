/**
 * Lazy ffmpeg.wasm loader.
 *
 * Uses the single-threaded core (~25 MB) served from `/ffmpeg-core/` (copied
 * from `@ffmpeg/core` at install time). Single-threaded keeps the COOP/COEP
 * setup simple — no SharedArrayBuffer-backed threads, no nested workers.
 * Slower than the MT core but the fallback path is rare so it's a fair
 * trade. The bundled `ffmpeg.worker.js` is the wrapper from
 * `@ffmpeg/ffmpeg`, which we serve via `classWorkerURL` so Vite doesn't
 * have to discover `new URL("./worker.js", import.meta.url)` inside the
 * library.
 */

import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";
// Vite handles `?worker&url` by building the worker (with its imports
// transitively bundled) and exposing the resulting URL as the default
// import. This sidesteps the relative-import problem we'd hit if we just
// dropped @ffmpeg/ffmpeg's worker.js into /public/ as-is.
import ffmpegWorkerUrl from "@ffmpeg/ffmpeg/worker?worker&url";

const BASE_URL = "/ffmpeg-core";

let loadPromise: Promise<FFmpeg> | null = null;

export function getFfmpeg(): Promise<FFmpeg> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const ffmpeg = new FFmpeg();
      // Use the ESM core build because @ffmpeg/ffmpeg's worker creates a
      // module-type Worker (when classWorkerURL is set) and needs a
      // dynamically importable script, not the UMD `importScripts` flavour.
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${BASE_URL}/ffmpeg-core-esm.js`, "text/javascript"),
        toBlobURL(`${BASE_URL}/ffmpeg-core-esm.wasm`, "application/wasm"),
      ]);
      await ffmpeg.load({
        coreURL,
        wasmURL,
        classWorkerURL: ffmpegWorkerUrl,
      });
      return ffmpeg;
    })();
  }
  return loadPromise;
}

/** Resets the singleton (test-only — production never needs this). */
export function _resetFfmpegForTests(): void {
  loadPromise = null;
}
