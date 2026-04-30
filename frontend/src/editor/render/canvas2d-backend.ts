/**
 * Canvas2D compositor backend.
 *
 * Drives both:
 *   - the live preview's Canvas2D fallback path (when WebGL2 unavailable)
 *   - the export pipeline (replaces the inline drawing in
 *     `frontend/src/local/render/compositor.ts` once Schritt 8 lands)
 *
 * Pixel-producing logic for FX is delegated to `fxCatalog[kind]
 * .drawCanvas2D` — same code path as today's preview Canvas2DFxRenderer,
 * so a vignette here looks identical to a vignette in the existing
 * preview overlay.
 *
 * Rotation/flip composition matches `compositor.ts`'s `compositeImage`
 * (translate → rotate → scale flip → drawImage) so a frame baked by
 * the export side is bit-equivalent to a frame painted by the preview
 * after Schritt 7 ships.
 */
import { fxCatalog } from "../fx/catalog";
import type { PunchFx } from "../fx/types";
import type {
  BackendCaps,
  CompositorBackend,
  LayerSource,
  SourcesMap,
} from "./backend";
import { BackendError } from "./backend";
import type { FrameDescriptor, FrameLayer } from "./frame-descriptor";

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type AnyCtx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export class Canvas2DBackend implements CompositorBackend {
  readonly id = "canvas2d" as const;

  private canvas: AnyCanvas | null = null;
  private ctx: AnyCtx2D | null = null;
  private caps: BackendCaps = { pixelW: 1, pixelH: 1 };

  async init(canvas: AnyCanvas, caps: BackendCaps): Promise<void> {
    this.initSync(canvas, caps);
  }

  /** Synchronous setup — for callers that can't `await` (notably
   *  `compositor.ts` which keeps a synchronous public API for the
   *  encoder loop). Behaviour identical to `init()`; the async form
   *  exists only to satisfy the `CompositorBackend` interface. */
  initSync(canvas: AnyCanvas, caps: BackendCaps): void {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d") as AnyCtx2D | null;
    if (!ctx) {
      throw new BackendError(
        "init",
        "Canvas2DBackend: getContext('2d') returned null",
      );
    }
    this.ctx = ctx;
    this.resize(caps);
  }

  resize(caps: BackendCaps): void {
    this.caps = caps;
    if (!this.canvas) return;
    this.canvas.width = Math.max(1, Math.round(caps.pixelW));
    this.canvas.height = Math.max(1, Math.round(caps.pixelH));
    // Intentionally NOT touching `canvas.style.width / .height` — for
    // the live preview the surrounding container (Tailwind w-full h-full
    // inside OutputFrameBox) drives the CSS size, and an inline width
    // would clobber that. For export, OffscreenCanvas has no style.
    // Callers that need explicit CSS sizing should set it themselves
    // before / after init().
  }

  warmup(): Promise<void> {
    // Canvas2D has no compile step. JIT happens on first draw and is
    // negligible compared to GPU shader compile (≤ 0.1 ms per call).
    return Promise.resolve();
  }

  drawFrame(d: FrameDescriptor, sources: SourcesMap): void {
    const ctx = this.ctx;
    if (!ctx) return;

    const { pixelW, pixelH } = this.caps;
    // Reset transform and clear the entire backbuffer first — we always
    // start from a known state so partial-failure during draw can't leak
    // pixels from the previous frame.
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, pixelW, pixelH);

    if (!d.output) return;

    // Map descriptor output coords → backbuffer pixels. Lets the
    // resolution-scale dial (Schritt 9) shrink the backbuffer without
    // touching any of the layer/fx draw code below.
    const sx = pixelW / d.output.w;
    const sy = pixelH / d.output.h;
    ctx.setTransform(sx, 0, 0, sy, 0, 0);

    // Background fill (only when at least one layer needs letterbox /
    // pillarbox bars — but cheap to always paint, matches export today).
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, d.output.w, d.output.h);

    for (const layer of d.layers) {
      if (layer.weight <= 0) continue;
      const src = sources.get(layer.layerId);
      if (!src || src.kind === "test-pattern") continue;
      drawLayer(ctx, layer, src);
    }

    if (d.fx.length > 0) {
      const w = d.output.w;
      const h = d.output.h;
      for (const fx of d.fx) {
        const def = fxCatalog[fx.kind];
        if (!def) continue;
        const punch: PunchFx = {
          id: fx.id,
          kind: fx.kind,
          // The draw functions only read params; in/out aren't used.
          inS: 0,
          outS: 0,
          params: fx.params,
        };
        ctx.save();
        def.drawCanvas2D(ctx, punch, w, h);
        ctx.restore();
      }
    }
  }

  dispose(): void {
    this.canvas = null;
    this.ctx = null;
  }
}

/** Draw one layer onto `ctx` using the same translate→rotate→scale order
 *  as `compositor.ts`. Coordinates are in descriptor-output units; the
 *  caller has set up the output→pixel scale transform already. */
function drawLayer(ctx: AnyCtx2D, layer: FrameLayer, src: LayerSource): void {
  const image = sourceToImage(src);
  if (!image) return;

  const { fitRect, rotationDeg, flipX, flipY, displayW, displayH } = layer;
  const swap = rotationDeg === 90 || rotationDeg === 270;

  // displayW/H are POST-rotation dims. The undo: drawImage uses pre-
  // rotation source dims (drawW/drawH) so the rotated draw lands inside
  // the post-rotation fitRect. swap reverses to recover pre-rotation.
  const drawW = swap ? fitRect.h : fitRect.w;
  const drawH = swap ? fitRect.w : fitRect.h;
  // Quiet the unused-var lint for the intentionally-passed-through metadata.
  void displayW;
  void displayH;

  if (rotationDeg === 0 && !flipX && !flipY) {
    ctx.drawImage(image, fitRect.x, fitRect.y, fitRect.w, fitRect.h);
    return;
  }

  const cx = fitRect.x + fitRect.w / 2;
  const cy = fitRect.y + fitRect.h / 2;

  ctx.save();
  ctx.translate(cx, cy);
  if (rotationDeg !== 0) ctx.rotate((rotationDeg * Math.PI) / 180);
  if (flipX || flipY) ctx.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  ctx.drawImage(image, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();
}

function sourceToImage(src: LayerSource): CanvasImageSource | null {
  switch (src.kind) {
    case "video":
      return src.element;
    case "videoframe":
      return src.frame as unknown as CanvasImageSource;
    case "image":
      return src.bitmap;
    case "test-pattern":
      return null;
  }
}
