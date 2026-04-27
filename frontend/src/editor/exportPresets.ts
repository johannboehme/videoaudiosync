/**
 * Export-preset / quality helpers.
 *
 * The Studio-Console export panel composes three orthogonal choices —
 * destination preset, output resolution, and quality step — into a single
 * `ExportSpec`. These helpers define the contracts for each axis so the UI
 * and the render pipeline stay in sync.
 *
 * Aspect-aware presets fix the long-standing Mobile bug: the old preset
 * hardcoded 1280×720, which made portrait phone footage look wrong.
 */

import type {
  ExportPreset,
  ExportSpec,
  QualityStep,
} from "./types";

export interface SourceProbe {
  w: number;
  h: number;
  durationS: number;
}

export interface BitratePair {
  videoKbps: number;
  audioKbps: number;
}

/**
 * Base bitrate ladder, expressed at 1080p. Real bitrates scale with pixel
 * area so that a 4K render gets ~4× this and a 720p render ~0.45×.
 */
const QUALITY_LADDER: Record<Exclude<QualityStep, "custom">, BitratePair> = {
  tiny: { videoKbps: 800, audioKbps: 64 },
  low: { videoKbps: 2000, audioKbps: 96 },
  good: { videoKbps: 3500, audioKbps: 128 },
  high: { videoKbps: 6000, audioKbps: 192 },
  pristine: { videoKbps: 12000, audioKbps: 256 },
};

const REFERENCE_PIXELS = 1920 * 1080;

/**
 * Returns the bitrate pair for a quality step at a given output resolution.
 * Audio bitrate is independent of resolution; video scales with pixel area.
 *
 * Falls back to "good" semantics for the "custom" step — the panel uses a
 * different code path when the user has set bitrates explicitly, so this
 * is a safe default for any caller that asks naively.
 */
export function qualityToBitrates(
  step: QualityStep,
  resolution: { w: number; h: number },
): BitratePair {
  const key = step === "custom" ? "good" : step;
  const base = QUALITY_LADDER[key];
  const pixelScale = (resolution.w * resolution.h) / REFERENCE_PIXELS;
  return {
    videoKbps: Math.round(base.videoKbps * pixelScale),
    audioKbps: base.audioKbps,
  };
}

/**
 * Translate the `resolution` field of an ExportSpec into concrete pixels.
 */
export function resolveResolution(
  resolution: ExportSpec["resolution"],
  source: { w: number; h: number },
): { w: number; h: number } {
  if (resolution === undefined || resolution === "source") {
    return { w: source.w, h: source.h };
  }
  return resolution;
}

/**
 * Cap the long side of a source to `maxLong`, preserving aspect ratio.
 * Always rounds dims to even pixels — most encoders demand it.
 */
function capLongSide(source: { w: number; h: number }, maxLong: number) {
  const long = Math.max(source.w, source.h);
  if (long <= maxLong) {
    return { w: roundEven(source.w), h: roundEven(source.h) };
  }
  const scale = maxLong / long;
  return {
    w: roundEven(source.w * scale),
    h: roundEven(source.h * scale),
  };
}

function roundEven(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}

/**
 * Build an ExportSpec for a preset, given the source the user uploaded.
 *
 * - WEB: long-side capped at 1920, H.264, Good quality.
 * - ARCHIVE: source unchanged, H.265, Pristine quality.
 * - MOBILE: long-side capped at 1920, H.264, Low quality. Aspect preserved
 *   (was hardcoded 1280×720 — that's the bug).
 * - CUSTOM: returns only the preset discriminator. Callers keep the prior
 *   ExportSpec so the user's manual settings aren't reset by switching tabs.
 */
export function applyPreset(
  preset: ExportPreset,
  source: SourceProbe,
): Partial<ExportSpec> & { preset: ExportPreset } {
  if (preset === "custom") {
    return { preset: "custom" };
  }
  const sourceRes = { w: source.w, h: source.h };
  switch (preset) {
    case "web": {
      const res = capLongSide(sourceRes, 1920);
      const { videoKbps, audioKbps } = qualityToBitrates("good", res);
      return {
        preset: "web",
        format: "mp4",
        resolution: res,
        video_codec: "h264",
        audio_codec: "aac",
        video_bitrate_kbps: videoKbps,
        audio_bitrate_kbps: audioKbps,
        quality: "good",
      };
    }
    case "archive": {
      const res = { w: roundEven(source.w), h: roundEven(source.h) };
      const { videoKbps, audioKbps } = qualityToBitrates("pristine", res);
      return {
        preset: "archive",
        format: "mp4",
        resolution: res,
        video_codec: "h265",
        audio_codec: "aac",
        video_bitrate_kbps: videoKbps,
        audio_bitrate_kbps: audioKbps,
        quality: "pristine",
      };
    }
    case "mobile": {
      const res = capLongSide(sourceRes, 1920);
      const { videoKbps, audioKbps } = qualityToBitrates("low", res);
      return {
        preset: "mobile",
        format: "mp4",
        resolution: res,
        video_codec: "h264",
        audio_codec: "aac",
        video_bitrate_kbps: videoKbps,
        audio_bitrate_kbps: audioKbps,
        quality: "low",
      };
    }
  }
}

/**
 * Estimate output file size from the bitrate × duration formula. Returns
 * bytes; the UI formats them into KB/MB/GB. Rounds to bytes (no fractional).
 */
export function estimateFileSizeBytes(input: {
  videoKbps: number;
  audioKbps: number;
  durationS: number;
}): number {
  if (input.durationS <= 0) return 0;
  const totalKbps = input.videoKbps + input.audioKbps;
  if (totalKbps <= 0) return 0;
  return Math.round((totalKbps * 1000 * input.durationS) / 8);
}

/**
 * Format `bytes` as a human-readable string. Mirrors the convention the
 * rest of the app uses (decimal SI prefixes — what file managers show).
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1000) return `${bytes} B`;
  if (bytes < 1_000_000) return `${(bytes / 1000).toFixed(0)} KB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(0)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(2)} GB`;
}

export interface RenderOutputOpts {
  width?: number;
  height?: number;
  videoCodec: "h264" | "h265";
  audioCodec: "aac" | "opus";
  videoBitrateBps: number;
  audioBitrateBps: number;
}

/**
 * Translate a UI-layer `ExportSpec` into the raw render-pipeline options.
 * Source dimensions are required because "source" resolution in the spec
 * is shorthand that the renderer can't follow on its own.
 */
export function exportSpecToRenderOpts(
  spec: ExportSpec,
  source: { w: number; h: number },
): RenderOutputOpts {
  const res = resolveResolution(spec.resolution, source);
  return {
    width: res.w,
    height: res.h,
    videoCodec: spec.video_codec ?? "h264",
    audioCodec: spec.audio_codec ?? "aac",
    videoBitrateBps: (spec.video_bitrate_kbps ?? 3500) * 1000,
    audioBitrateBps: (spec.audio_bitrate_kbps ?? 128) * 1000,
  };
}
