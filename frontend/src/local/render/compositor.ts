/**
 * Per-frame compositor for the edit-render pipeline.
 *
 * Pipeline per output frame:
 *   1. Draw the source VideoFrame onto the main canvas.
 *   2. Paint any active audio-reactive Visualizer layers on top.
 *   3. Burn in text overlays via our Canvas2D ASS-subset renderer.
 *   4. Wrap the canvas as a new VideoFrame for the encoder.
 *
 * The `ass-builder` module is still the source of truth for what a
 * downloadable .ass file should look like (e.g. for external use); the
 * `ass-renderer` here is the source of truth for what burns into rendered
 * video. They share the TextOverlay shape so a spec built once is
 * faithful to both.
 */

import type { TextOverlay, EnergyCurves } from "./ass-builder";
import { buildAss } from "./ass-builder";
import { renderOverlays } from "./ass-renderer";
import type { Visualizer } from "./visualizer/types";

export interface CompositorOptions {
  width: number;
  height: number;
  overlays: TextOverlay[];
  energy?: EnergyCurves | null;
  visualizers?: Visualizer[];
}

export class Compositor {
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  private opts: CompositorOptions;
  private assBlob: string | null = null;

  constructor(opts: CompositorOptions) {
    this.opts = opts;
    this.canvas = new OffscreenCanvas(opts.width, opts.height);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Compositor: OffscreenCanvas 2d context unavailable");
    this.ctx = ctx;
  }

  /**
   * Pre-build the ASS string (used for external download / debugging).
   * Returns immediately — there's no async setup needed for the renderer.
   */
  async ensureSubtitleEngine(): Promise<void> {
    if (this.opts.overlays.length === 0) return;
    this.assBlob = buildAss(
      this.opts.overlays,
      this.opts.width,
      this.opts.height,
      this.opts.energy ?? null,
    );
  }

  /** Returns the generated ASS document, or null if no overlays were set. */
  getAssDocument(): string | null {
    return this.assBlob;
  }

  /**
   * Composite `frame` for `timestampUs` and return a fresh VideoFrame whose
   * caller MUST `.close()` after encoding.
   */
  composite(frame: VideoFrame, timestampUs: number): VideoFrame {
    this.ctx.clearRect(0, 0, this.opts.width, this.opts.height);
    this.ctx.drawImage(
      frame as unknown as CanvasImageSource,
      0,
      0,
      this.opts.width,
      this.opts.height,
    );

    const t = timestampUs / 1_000_000;

    // Visualizer layers (Canvas2D drawn directly on top of the main canvas).
    if (this.opts.visualizers && this.opts.visualizers.length > 0) {
      for (const v of this.opts.visualizers) {
        v.draw(this.ctx, t, this.opts.width, this.opts.height);
      }
    }

    // Subtitle layer (text overlays).
    if (this.opts.overlays.length > 0) {
      renderOverlays(
        this.ctx,
        this.opts.overlays,
        this.opts.width,
        this.opts.height,
        t,
        this.opts.energy ?? null,
      );
    }

    return new VideoFrame(this.canvas, {
      timestamp: timestampUs,
      duration: frame.duration ?? 0,
    });
  }

  destroy(): void {
    // Nothing to tear down — pure Canvas2D rendering, no worker resources.
  }
}
