/**
 * Per-frame compositor for the edit-render pipeline.
 *
 * Pipeline per output frame:
 *   1. Layer + FX pass via the shared CompositorBackend
 *      (WebGPU → WebGL2 → Canvas2D fallback ladder, picked by
 *      `createBackend()` from `editor/render/factory.ts`). The
 *      backend writes its result into an internal `OffscreenCanvas`.
 *   2. The internal backend canvas is blitted into the final 2D
 *      `OffscreenCanvas` via `drawImage()` — once per frame.
 *   3. Audio-reactive Visualizer layers are painted on top with 2D ctx.
 *   4. Text overlays are burned in via the Canvas2D ASS-subset renderer.
 *   5. The final 2D canvas is wrapped as a new VideoFrame for the encoder.
 *
 * Rationale for the two-canvas pattern: the live preview now uses the
 * same `createBackend()` factory, which means the export's backend may
 * be WebGPU/WebGL2 (GPU context) — and a single canvas can't hold both
 * a GPU context and a 2D context. Visualizers + overlays still render
 * via Canvas2D (they're audio-reactive + text-rendering code, not
 * shader-friendly), so we composite GPU output into a 2D canvas first.
 *
 * Result: preview and export share the same backend code AND the same
 * backend choice, eliminating the long-standing "WEAR/TAPE look
 * different in render vs preview" bug. See [memory:
 * Render-Backends mit Fallback-Ladder].
 */

import type { TextOverlay, EnergyCurves } from "./ass-builder";
import { buildAss } from "./ass-builder";
import { renderOverlays } from "./ass-renderer";
import type { Visualizer } from "./visualizer/types";
import type { PunchFx } from "../../editor/fx/types";
import { activeFxAt } from "../../editor/fx/active";
import { fxCatalog } from "../../editor/fx/catalog";
import { envelopeAt, INSTANT_ENVELOPE } from "../../editor/fx/envelope";
import {
  createBackend,
  type BackendCapabilities,
} from "../../editor/render/factory";
import type {
  CompositorBackend,
  LayerSource,
  SourcesMap,
} from "../../editor/render/backend";
import type {
  FrameDescriptor,
  FrameFx,
  FrameLayer,
} from "../../editor/render/frame-descriptor";

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
   *  visualizers and text overlays. Same `fxCatalog[kind]` impl as the
   *  live preview — single source of truth per kind. */
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
    const h = dstW / srcAspect;
    return { x: 0, y: (dstH - h) / 2, w: dstW, h, fillsCanvas: false };
  }
  const w = dstH * srcAspect;
  return { x: (dstW - w) / 2, y: 0, w, h: dstH, fillsCanvas: false };
}

export class Compositor {
  /** Final 2D output canvas — blitted backend output + visualizers +
   *  overlays end up here, gets wrapped in the VideoFrame. */
  private canvas: OffscreenCanvas;
  private ctx: OffscreenCanvasRenderingContext2D;
  /** Internal backend canvas (GPU- or 2D-context, depending on
   *  Backend tier). Layer + FX render here. */
  private backendCanvas: OffscreenCanvas;
  private backend: CompositorBackend;
  private opts: CompositorOptions;
  private assBlob: string | null = null;

  /** Konstruktor ist private; Aufrufer nutzen `Compositor.create()` weil
   *  der Backend-Factory async ist. */
  private constructor(
    opts: CompositorOptions,
    canvas: OffscreenCanvas,
    ctx: OffscreenCanvasRenderingContext2D,
    backendCanvas: OffscreenCanvas,
    backend: CompositorBackend,
  ) {
    this.opts = opts;
    this.canvas = canvas;
    this.ctx = ctx;
    this.backendCanvas = backendCanvas;
    this.backend = backend;
  }

  /** Async-Factory. Picks the best backend for `capabilities` via
   *  `createBackend()` and binds it to an internal OffscreenCanvas. */
  static async create(
    opts: CompositorOptions,
    capabilities: BackendCapabilities,
  ): Promise<Compositor> {
    const canvas = new OffscreenCanvas(opts.width, opts.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Compositor: OffscreenCanvas 2d context unavailable");
    }
    const backendCanvas = new OffscreenCanvas(opts.width, opts.height);
    const backend = await createBackend(
      backendCanvas,
      { pixelW: opts.width, pixelH: opts.height },
      capabilities,
    );
    await backend.warmup();
    return new Compositor(opts, canvas, ctx, backendCanvas, backend);
  }

  /** Pre-build the ASS string (used for external download / debugging). */
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

  /** Composite `frame` for `timestampUs` and return a fresh VideoFrame whose
   *  caller MUST `.close()` after encoding. */
  composite(frame: VideoFrame, timestampUs: number): VideoFrame {
    return this.compositeImage(
      frame as unknown as CanvasImageSource,
      this.opts.sourceWidth ?? frame.codedWidth,
      this.opts.sourceHeight ?? frame.codedHeight,
      timestampUs,
      frame.duration ?? 0,
    );
  }

  compositeImage(
    source: CanvasImageSource,
    srcW: number,
    srcH: number,
    timestampUs: number,
    durationUs: number,
    rotationDeg: 0 | 90 | 180 | 270 = 0,
    userTransform: { rotation?: number; flipX?: boolean; flipY?: boolean } = {},
  ): VideoFrame {
    const intrinsic = rotationDeg % 360;
    const userRot =
      ((Math.round((userTransform.rotation ?? 0) / 90) * 90) % 360 + 360) % 360;
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
      ? activeFxAt(this.opts.fx, t)
          .map((fx) => {
            const def = fxCatalog[fx.kind];
            const env = fx.envelope ?? INSTANT_ENVELOPE;
            const wetness = envelopeAt(env, fx.outS - fx.inS, t - fx.inS);
            const merged = { ...def.defaultParams, ...(fx.params ?? {}) };
            const params =
              def.applyWetness && wetness < 1
                ? def.applyWetness(merged, wetness)
                : merged;
            return { id: fx.id, kind: fx.kind, inS: fx.inS, params, wetness };
          })
          .filter((f) => f.wetness > 0)
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

    // 1. Backend rendert Layer + FX in den internen backendCanvas.
    this.backend.drawFrame(descriptor, sources);

    // 2. Reset transform und blit den Backend-Output ins finale Canvas.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.opts.width, this.opts.height);
    // drawImage() funktioniert mit OffscreenCanvas (sowohl 2D- als auch
    // GPU-Context-backed) als Source in modernen Engines (Chromium ≥113,
    // Safari 17, Firefox 116). Falls eine ältere Engine fehlschlägt,
    // ist ImageBitmap → drawImage der Workaround; nicht hier nötig.
    this.ctx.drawImage(this.backendCanvas, 0, 0);

    // 3. Visualizer + Overlays auf den finalen 2D-Context.
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

/** Map a generic CanvasImageSource into the backend's LayerSource union. */
function classifySource(source: CanvasImageSource): LayerSource {
  if (typeof VideoFrame !== "undefined" && source instanceof VideoFrame) {
    return { kind: "videoframe", frame: source };
  }
  return { kind: "image", bitmap: source as ImageBitmap | HTMLImageElement };
}
