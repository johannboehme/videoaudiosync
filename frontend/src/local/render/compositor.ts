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
import type { PunchFx } from "../../editor/fx/types";
import { activeFxAt } from "../../editor/fx/active";
import { fxCatalog } from "../../editor/fx/catalog";
import { Canvas2DBackend } from "../../editor/render/canvas2d-backend";
import type {
  FrameDescriptor,
  FrameFx,
  FrameLayer,
} from "../../editor/render/frame-descriptor";
import type { LayerSource, SourcesMap } from "../../editor/render/backend";

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
  /** Punch-in FX with in/out spans on the master timeline. Active fx at
   *  the current frame's timestamp paint over the source frame BEFORE
   *  visualizers and text overlays. Same `drawCanvas2D` impl as the
   *  live-preview's Canvas2D fallback — single source of truth per kind. */
  fx?: readonly PunchFx[];
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
  /** Shared draw pipeline — same Canvas2DBackend the live preview uses
   *  when WebGL2 is unavailable. Routing the export through this
   *  ensures preview ↔ export pixel parity by construction; whatever
   *  the backend draws on a frame N descriptor here is exactly what
   *  the preview RAF would draw on the same descriptor. */
  private backend: Canvas2DBackend;

  constructor(opts: CompositorOptions) {
    this.opts = opts;
    this.canvas = new OffscreenCanvas(opts.width, opts.height);
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Compositor: OffscreenCanvas 2d context unavailable");
    this.ctx = ctx;
    this.backend = new Canvas2DBackend();
    this.backend.initSync(this.canvas, { pixelW: opts.width, pixelH: opts.height });
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
   *
   * `userTransform` is the per-clip rotation+flip the user applied via
   * the Options panel. Stacked on top of `rotationDeg` (intrinsic) so the
   * effective rotation is `(intrinsic + user) mod 360`. Flip is applied
   * AFTER rotation in the source's stored frame (so a horizontal flip is
   * always horizontal from the user's point of view, regardless of how
   * the cam was rotated).
   */
  compositeImage(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    timestampUs: number,
    durationUs: number,
    rotationDeg: 0 | 90 | 180 | 270 = 0,
    userTransform: { rotation?: number; flipX?: boolean; flipY?: boolean } = {},
  ): VideoFrame {
    // Intrinsic + user rotation, snapped to 90° steps. Free angles aren't
    // supported in V1 (the bbox / fit math would need a rotated AABB).
    const intrinsic = rotationDeg % 360;
    const userRot = ((Math.round((userTransform.rotation ?? 0) / 90) * 90) % 360 + 360) % 360;
    const rot = ((intrinsic + userRot) % 360) as 0 | 90 | 180 | 270;
    const flipX = !!userTransform.flipX;
    const flipY = !!userTransform.flipY;
    const swap = rot === 90 || rot === 270;
    const dispW = swap ? srcH : srcW;
    const dispH = swap ? srcW : srcH;
    const fit = computeFitRect(dispW, dispH, this.opts.width, this.opts.height);

    const t = timestampUs / 1_000_000;

    const layer: FrameLayer = {
      layerId: "src",
      // Kind is informational at this layer — the backend dispatches on
      // the SourcesMap entry's kind, not this one.
      source: { kind: "video", clipId: "src", sourceTimeS: 0, sourceDurS: 0 },
      weight: 1,
      fitRect: { x: fit.x, y: fit.y, w: fit.w, h: fit.h },
      rotationDeg: rot,
      flipX,
      flipY,
      displayW: dispW,
      displayH: dispH,
    };

    const fxFrame: FrameFx[] = this.opts.fx
      ? activeFxAt(this.opts.fx, t).map((fx) => ({
          id: fx.id,
          kind: fx.kind,
          inS: fx.inS,
          params: { ...fxCatalog[fx.kind].defaultParams, ...(fx.params ?? {}) },
        }))
      : [];

    const descriptor: FrameDescriptor = {
      tMaster: t,
      output: { w: this.opts.width, h: this.opts.height },
      layers: [layer],
      fx: fxFrame,
    };

    const sources: SourcesMap = new Map<string, LayerSource>([
      ["src", classifySource(source)],
    ]);

    // Layer + fx pass — same code path as the live preview's Canvas2D
    // fallback. Bit-equivalent pixels for any (rotation, flip, fx)
    // combination by construction.
    this.backend.drawFrame(descriptor, sources);

    // Reset transform before visualizers / overlays so they render in
    // raw output-pixel coords. Backend leaves the canvas in a scale-
    // transformed state that's identity here (pixelW == output.w on
    // the export side) but explicit reset is cheap insurance.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);

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
    this.backend.dispose();
  }
}

/** Map a generic CanvasImageSource into the backend's LayerSource union.
 *  ImageBitmap / OffscreenCanvas / HTMLImageElement land in the "image"
 *  bucket (the backend's `drawImage` accepts any of them). VideoFrame
 *  uses the dedicated "videoframe" branch so future GPU backends can
 *  pick `importExternalTexture` instead of an upload. */
function classifySource(source: CanvasImageSource): LayerSource {
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return { kind: "videoframe", frame: source };
  }
  return { kind: "image", bitmap: source as ImageBitmap | HTMLImageElement };
}
