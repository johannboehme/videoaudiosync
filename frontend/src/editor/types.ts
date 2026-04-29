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
  /** Discriminator. Optional for backward-compat in tests; defaults to
   *  "video" when absent. */
  kind?: "video";
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
  /** Per-clip trim from the source's start (seconds, 0..sourceDurationS).
   *  Optional — undefined / 0 = full source from frame 0. The cam still
   *  plays from source-time 0 onward; trim only restricts the master-
   *  timeline range during which this cam is "available" for cuts /
   *  rendering. */
  trimInS?: number;
  /** Per-clip trim end (seconds, in source-time). Undefined = full
   *  source through the end. */
  trimOutS?: number;
  /** Post-rotation displayed width/height (CSS-pixel scale, browser-
   *  decoded). Filled in lazily when the underlying `<video>` reports
   *  loadedmetadata. Used by the output-frame resolver to compute the
   *  bounding-box (max W, max H) over all clips so the preview + render
   *  always covers every cam regardless of which is currently active. */
  displayW?: number;
  displayH?: number;
}

/**
 * In-memory representation of a still-image clip on the master timeline.
 *
 * Image clips have no audio track, no sync, no drift — only a user-set
 * duration and a free placement offset. They share the cam-id namespace
 * with VideoClips so cuts (which reference cam IDs) work transparently.
 */
export interface ImageClip {
  kind: "image";
  id: string;
  filename: string;
  color: string;
  /** User-chosen length on the master timeline (seconds). */
  durationS: number;
  /** Master-timeline placement offset (seconds). The clip occupies
   *  [startOffsetS, startOffsetS + durationS). */
  startOffsetS: number;
  /** Natural pixel size of the image. Same role as VideoClip's
   *  displayW/H — feeds the output-frame bounding-box resolver. */
  displayW?: number;
  displayH?: number;
}

export type Clip = VideoClip | ImageClip;

/** True iff the clip is an image clip (kind === "image"). VideoClips may
 *  have kind undefined or "video"; both count as video. */
export function isImageClip(c: Clip): c is ImageClip {
  return c.kind === "image";
}
export function isVideoClip(c: Clip): c is VideoClip {
  return c.kind !== "image";
}

/**
 * Compute the [startS, endS) range a clip occupies on the master timeline.
 *
 * Video sign convention: `syncOffsetMs` is the delay applied to the master
 * audio to align with this video's audio. When positive, the master audio
 * starts later than the video → the video begins *before* master t=0, so
 * its startS is negative. `syncOverrideMs` and `startOffsetS` add to this.
 *
 * Image clips have no sync — they sit at `startOffsetS` for `durationS`.
 */
export function clipRangeS(clip: Clip): { startS: number; endS: number } {
  if (isImageClip(clip)) {
    return { startS: clip.startOffsetS, endS: clip.startOffsetS + clip.durationS };
  }
  const totalSyncS = (clip.syncOffsetMs + clip.syncOverrideMs) / 1000;
  const baseStartS = -totalSyncS + clip.startOffsetS;
  // Per-clip trim applies on top of the cam's natural master-timeline
  // span. The cam still *plays* from source-time 0 onward, but only the
  // [startS + trimInS, startS + trimOutS] portion is "available" — cuts
  // outside this window route to other cams or the test pattern.
  const trimInS = clip.trimInS ?? 0;
  const trimOutS = clip.trimOutS ?? clip.sourceDurationS;
  return {
    startS: baseStartS + trimInS,
    endS: baseStartS + trimOutS,
  };
}

