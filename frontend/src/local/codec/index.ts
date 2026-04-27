/**
 * Codec resolver: a single entry point that picks the best backend per
 * operation. Callers (sync, render) don't know whether WebCodecs or
 * ffmpeg.wasm did the work — they only see PCM / chunks coming out.
 *
 * Strategy:
 *   1. Try WebCodecs (fast, hardware-accelerated, no extra bundle).
 *   2. On failure (unsupported codec / container, NotSupportedError, etc.),
 *      fall back to ffmpeg.wasm (lazy-loaded, ~25 MB, slow but universal).
 *
 * The result reports which backend won (`.backend`) so the UI can show it
 * to the user — that's the "Mechanismus-Indikator" requirement from the
 * plan: "es sollte ersichtlich sein, was für Mechanismen verwendet werden".
 */

import {
  decodeAudioToMonoPcm as webcodecsDecodeAudio,
  type DecodedAudio,
} from "./webcodecs/audio-decode";

let ffmpegAudioDecodeImpl:
  | ((source: Blob | ArrayBuffer, targetSampleRate: number) => Promise<DecodedAudio>)
  | null = null;

async function loadFfmpegAudioDecode() {
  if (!ffmpegAudioDecodeImpl) {
    const mod = await import("./ffmpeg/audio-decode");
    ffmpegAudioDecodeImpl = mod.decodeAudioToMonoPcmFfmpeg;
  }
  return ffmpegAudioDecodeImpl;
}

export interface CodecResolverOptions {
  /** Force a specific backend (escape hatch for debugging / tests). */
  forceBackend?: "webcodecs" | "ffmpeg-wasm";
}

export async function decodeAudioToMonoPcm(
  source: Blob | ArrayBuffer,
  targetSampleRate: number,
  opts: CodecResolverOptions = {},
): Promise<DecodedAudio> {
  if (opts.forceBackend === "ffmpeg-wasm") {
    const ffDecode = await loadFfmpegAudioDecode();
    return ffDecode(source, targetSampleRate);
  }
  if (opts.forceBackend === "webcodecs") {
    return webcodecsDecodeAudio(source, targetSampleRate);
  }
  // Default: try WebCodecs / decodeAudioData first, fall back on failure.
  try {
    return await webcodecsDecodeAudio(source, targetSampleRate);
  } catch (err) {
    if (err instanceof Error && /webkit|webcodecs/i.test(err.name)) {
      // give up, no fallback path can do better than the native decoder
      throw err;
    }
    // Most decode failures (NotSupportedError, EncodingError, etc.) get
    // here. The decodeAudioData rejection types are notoriously inconsistent,
    // so we treat any failure as a signal to try the heavier backend.
    const ffDecode = await loadFfmpegAudioDecode();
    return ffDecode(source, targetSampleRate);
  }
}

export type { DecodedAudio };
