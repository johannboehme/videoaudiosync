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
   *
   * `rotationDeg` is the source's display rotation as decoded from its
   * MP4 transform matrix (0/90/180/270). Phone recordings held in
   * portrait carry 90 or 270 here — the browser's `<video>` element
   * applies it implicitly in preview, so the render must too or the
   * output comes out sideways relative to what the user finetuned.
   */
  compositeImage(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    timestampUs: number,
    durationUs: number,
    rotationDeg: 0 | 90 | 180 | 270 = 0,
  ): VideoFrame {
    // After rotation the *displayed* dimensions are swapped for 90/270.
    // Fit / aspect-pillarbox is computed against those displayed dims.
    const rot = rotationDeg % 360;
    const swap = rot === 90 || rot === 270;
    const dispW = swap ? srcH : srcW;
    const dispH = swap ? srcW : srcH;
    const fit = computeFitRect(dispW, dispH, this.opts.width, this.opts.height);

    if (rot === 0) {
      if (fit.fillsCanvas) {
        this.ctx.drawImage(source, 0, 0, this.opts.width, this.opts.height);
      } else {
        this.ctx.fillStyle = "#000";
        this.ctx.fillRect(0, 0, this.opts.width, this.opts.height);
        this.ctx.drawImage(source, fit.x, fit.y, fit.w, fit.h);
      }
    } else {
      // Rotated path: draw into a transformed coordinate system whose
      // origin sits at the centre of the fit-rect, then place the source
      // (in its stored, un-rotated dimensions) symmetrically around it.
      this.ctx.fillStyle = "#000";
      this.ctx.fillRect(0, 0, this.opts.width, this.opts.height);
      const cx = fit.x + fit.w / 2;
      const cy = fit.y + fit.h / 2;
      // Stored (un-rotated) draw size = swap of (fit.w, fit.h) for 90/270.
      const drawW = swap ? fit.h : fit.w;
      const drawH = swap ? fit.w : fit.h;
      this.ctx.save();
      this.ctx.translate(cx, cy);
      this.ctx.rotate((rot * Math.PI) / 180);
      this.ctx.drawImage(source, -drawW / 2, -drawH / 2, drawW, drawH);
      this.ctx.restore();
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
