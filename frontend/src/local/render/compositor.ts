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
  /** Output canvas dimensions — what's encoded. Overlays + visualizers are
   *  laid out relative to these. */
  width: number;
  height: number;
  /** Source video dimensions. Defaults to width/height when not provided
   *  (i.e. pass-through, no scaling). When source ≠ output, the source frame
   *  is fit aspect-preserving and any spare canvas is filled with black. */
  sourceWidth?: number;
  sourceHeight?: number;
  overlays: TextOverlay[];
  energy?: EnergyCurves | null;
  visualizers?: Visualizer[];
}

function computeFitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): { x: number; y: number; w: number; h: number; fillsCanvas: boolean } {
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  const aspectMatch = Math.abs(srcAspect - dstAspect) < 1e-3;
  if (aspectMatch) {
    return { x: 0, y: 0, w: dstW, h: dstH, fillsCanvas: true };
  }
  if (srcAspect > dstAspect) {
    // Source is wider — fit to width, letterbox top/bottom.
    const h = dstW / srcAspect;
    return { x: 0, y: (dstH - h) / 2, w: dstW, h, fillsCanvas: false };
  }
  // Source is taller — fit to height, pillarbox left/right.
  const w = dstH * srcAspect;
  return { x: (dstW - w) / 2, y: 0, w, h: dstH, fillsCanvas: false };
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
    return this.compositeImage(
      frame as unknown as CanvasImageSource,
      this.opts.sourceWidth ?? frame.codedWidth,
      this.opts.sourceHeight ?? frame.codedHeight,
      timestampUs,
      frame.duration ?? 0,
    );
  }

  /**
   * Multi-source variant: caller provides an arbitrary `CanvasImageSource`
   * (VideoFrame, ImageBitmap, OffscreenCanvas …) plus its native dimensions.
   * Letterbox / pillarbox is recomputed per call so cams of different
   * aspects can share a single compositor + output stream.
   */
  compositeImage(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    timestampUs: number,
    durationUs: number,
  ): VideoFrame {
    const fit = computeFitRect(srcW, srcH, this.opts.width, this.opts.height);
    if (fit.fillsCanvas) {
      this.ctx.drawImage(source, 0, 0, this.opts.width, this.opts.height);
    } else {
      this.ctx.fillStyle = "#000";
      this.ctx.fillRect(0, 0, this.opts.width, this.opts.height);
      this.ctx.drawImage(source, fit.x, fit.y, fit.w, fit.h);
    }

    const t = timestampUs / 1_000_000;

    if (this.opts.visualizers && this.opts.visualizers.length > 0) {
      for (const v of this.opts.visualizers) {
        v.draw(this.ctx, t, this.opts.width, this.opts.height);
      }
    }
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
      duration: durationUs,
    });
  }

  destroy(): void {
    // Nothing to tear down — pure Canvas2D rendering, no worker resources.
  }
}
