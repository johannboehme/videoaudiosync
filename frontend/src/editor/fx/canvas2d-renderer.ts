/**
 * Canvas2D-Backed FxRenderer. Used in two situations:
 *   1. Live preview when the browser has no WebGL2 (fallback).
 *   2. Indirectly inside the render-pipeline `compositor.ts`, which
 *      calls `fxCatalog[kind].drawCanvas2D` itself — the renderer wraps
 *      that for the live-preview overlay-canvas use case.
 *
 * The renderer is *not* DRY duplication of compositor.ts: it adds the
 * RAF-side bookkeeping (clear, save/restore, DPR-aware setTransform). The
 * actual pixel-producing code is `fxCatalog[kind].drawCanvas2D` — shared.
 */
import { activeFxAt } from "./active";
import { fxCatalog } from "./catalog";
import type { FxRenderer } from "./render";
import type { PunchFx } from "./types";

void activeFxAt; // kept exported for tests; not used internally here.

export class Canvas2DFxRenderer implements FxRenderer {
  readonly backend = "canvas2d" as const;

  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  /** CSS-pixel size — what the catalog's drawCanvas2D operates in. */
  private cssW = 0;
  private cssH = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas2DFxRenderer: getContext('2d') returned null");
    }
    this.ctx = ctx as CanvasRenderingContext2D;
  }

  resize(cssWidth: number, cssHeight: number, dpr: number): void {
    this.cssW = Math.max(1, Math.round(cssWidth));
    this.cssH = Math.max(1, Math.round(cssHeight));
    this.canvas.width = Math.max(1, Math.round(cssWidth * dpr));
    this.canvas.height = Math.max(1, Math.round(cssHeight * dpr));
    this.canvas.style.width = `${cssWidth}px`;
    this.canvas.style.height = `${cssHeight}px`;
    // Drawing in CSS-pixel coordinates; the DPR-multiplier scales up to
    // device pixels. A single setTransform per resize is enough.
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(_t: number, activeFx: readonly PunchFx[]): void {
    const w = this.cssW;
    const h = this.cssH;
    this.ctx.clearRect(0, 0, w, h);
    if (activeFx.length === 0) return;
    for (const fx of activeFx) {
      const def = fxCatalog[fx.kind];
      if (!def) continue;
      this.ctx.save();
      def.drawCanvas2D(this.ctx, fx, w, h);
      this.ctx.restore();
    }
  }

  destroy(): void {
    // Nothing to release — Canvas2D context is GC'd with the element.
  }
}
