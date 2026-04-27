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
