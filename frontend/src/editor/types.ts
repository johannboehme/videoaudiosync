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

export interface ExportSpec {
  preset: ExportPreset;
  format?: "mp4" | "mov";
  resolution?: { w: number; h: number } | "source";
  video_codec?: "h264" | "h265";
  video_bitrate_kbps?: number;
  audio_bitrate_kbps?: number;
}

export interface EditSpec {
  version: 1;
  segments: Segment[];
  overlays: TextOverlay[];
  visualizer: VisualizerConfig | null;
  sync_override_ms?: number;
  export?: ExportSpec;
}
