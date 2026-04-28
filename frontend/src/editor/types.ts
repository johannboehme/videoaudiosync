/**
 * Editor-internal types. Previously these were re-used from the backend
 * API client; now that the app is fully local we keep them here so the
 * editor remains backend-agnostic.
 */

export interface Segment {
  in: number;
  out: number;
}

export interface ReactiveModulation {
  band: "bass" | "low_mids" | "mids" | "highs";
  param: "scale" | "y" | "rotate";
  amount: number;
}

export interface TextOverlay {
  type: "text";
  text: string;
  start: number;
  end: number;
  preset?: "plain" | "boxed" | "outline" | "glow" | "gradient";
  x?: number;
  y?: number;
  animation?: "fade" | "pop" | "slide_in" | "word_reveal" | "wobble" | "none";
  reactive?: ReactiveModulation;
}

export interface VisualizerConfig {
  type: "showcqt" | "showfreqs" | "showwaves" | "showspectrum" | "avectorscope";
  position?: "top" | "center" | "bottom";
  height_pct?: number;
  opacity?: number;
}

export type ExportPreset = "web" | "archive" | "mobile" | "custom";

export type QualityStep = "tiny" | "low" | "good" | "high" | "pristine" | "custom";

export interface ExportSpec {
  preset: ExportPreset;
  /** Output container. Currently only MP4 (mp4-muxer constraint). */
  format?: "mp4";
  /** Output dimensions, or "source" to keep the source's. */
  resolution?: { w: number; h: number } | "source";
  video_codec?: "h264" | "h265";
  audio_codec?: "aac" | "opus";
  video_bitrate_kbps?: number;
  audio_bitrate_kbps?: number;
  /** Snap-step the user picked on the quality slider. "custom" means they
   *  edited a bitrate manually so the slider visualises a free position. */
  quality?: QualityStep;
  /** Output filename (without extension — extension is derived from format). */
  filename?: string;
}

export interface EditSpec {
  version: 1;
  segments: Segment[];
  overlays: TextOverlay[];
  visualizer: VisualizerConfig | null;
  sync_override_ms?: number;
  export?: ExportSpec;
}

export interface MatchCandidate {
  offsetMs: number;
  confidence: number;
  overlapFrames: number;
}

/**
 * In-memory representation of one video clip on the master timeline.
 *
 * Built from the persisted `VideoAsset` plus user-editable bits
 * (per-cam nudge, drag-on-timeline offset). The derived position on the
 * master timeline is `clipRangeS(clip)` — the single place that knows the
 * sign convention between the sync algorithm and the master clock.
 */
export interface VideoClip {
  id: string;
  filename: string;
  color: string;
  sourceDurationS: number;
  /** Algorithm-derived sync offset (ms) of this cam vs. the master audio.
   *  Mirror of `candidates[selectedCandidateIdx].offsetMs` when candidates
   *  are present, kept as a flat field for legacy consumers. */
  syncOffsetMs: number;
  /** Per-cam user nudge (ms) — added on top of syncOffsetMs. */
  syncOverrideMs: number;
  /** Additional drag-on-timeline offset (seconds). 0 = positioned purely by sync. */
  startOffsetS: number;
  /** Per-cam drift relative to the master audio. > 1 means the cam clock
   *  ran faster than master, so each master-second corresponds to slightly
   *  more cam-source-time. Default 1 = no drift. Used by the preview and
   *  render to compute cam-source-time via `camSourceTimeS()`. */
  driftRatio: number;
  /** Top-K alternative offsets ranked by sample-level confidence. May be
   *  empty for legacy jobs; the editor falls back to syncOffsetMs alone. */
  candidates: MatchCandidate[];
  /** Index into `candidates` of the user-selected primary. Defaults to 0
   *  (top-confidence candidate). The user can move this with match-snap. */
  selectedCandidateIdx: number;
}

/**
 * Compute the [startS, endS) range a clip occupies on the master timeline.
 *
 * Sign convention: `syncOffsetMs` is the delay applied to the master audio
 * to align with this video's audio. When positive, the master audio starts
 * later than the video → the video begins *before* master t=0, so its
 * startS is negative. `syncOverrideMs` and `startOffsetS` add to this.
 */
export function clipRangeS(clip: VideoClip): { startS: number; endS: number } {
  const totalSyncS = (clip.syncOffsetMs + clip.syncOverrideMs) / 1000;
  const startS = -totalSyncS + clip.startOffsetS;
  return { startS, endS: startS + clip.sourceDurationS };
}
