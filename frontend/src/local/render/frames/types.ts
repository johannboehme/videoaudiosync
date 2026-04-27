/**
 * Shared types for the frame-strip extraction module.
 */

export interface FrameStripManifest {
  /** Number of tiles in the strip image (always ≥ 1). */
  tileCount: number;
  /** Width of one tile in pixels. */
  tileWidth: number;
  /** Height of one tile in pixels. */
  tileHeight: number;
  /** Total source duration the strip spans, in seconds. */
  durationS: number;
  /** Centre-of-tile timestamps in source time, seconds. Length = tileCount. */
  tileTimestampsS: number[];
  /** Which backend produced the strip. */
  backend: "webcodecs" | "ffmpeg-wasm";
}

export interface FrameStripResult {
  /** Encoded image (image/webp) — the tile-strip itself. */
  blob: Blob;
  manifest: FrameStripManifest;
}
