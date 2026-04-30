/**
 * FxRenderer interface + factory.
 *
 * The renderer owns the output canvas surface. The FxOverlay component
 * mounts a renderer once, calls resize() on layout changes, render() on
 * every RAF tick (gated to active-only), and destroy() on unmount.
 *
 * Today we ship Canvas2D + WebGL2. WebGPU is a future-slot — picker in
 * `createFxRenderer` will drop in there once its renderer lands.
 */
import type { PunchFx } from "./types";
import { Canvas2DFxRenderer } from "./canvas2d-renderer";
import { WebGL2FxRenderer } from "./webgl2/webgl2-renderer";

export interface FxRenderer {
  /** Resize the underlying drawing surface. CSS size may differ from
   *  pixel size — the renderer handles its own DPR scaling. Idempotent. */
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  /** Render the active fx for master-time `t`. The fx list should be
   *  pre-filtered (i.e. only active entries) — keeps the renderer
   *  uncoupled from the time-resolution logic. */
  render(t: number, activeFx: readonly PunchFx[]): void;
  /** Drop GPU resources and detach. */
  destroy(): void;
  /** Eagerly compile/link every registered FX program now, instead of
   *  paying the cost on the first RAF tick that activates it. Safe to
   *  call multiple times (cache hits are no-ops). For backends without
   *  a compile step (Canvas2D), this is a no-op. */
  warmup(): void;
  /** Which backend was actually instantiated — useful for the dev console
   *  to show a one-line "FX backend: webgl2" log. */
  readonly backend: "webgl2" | "canvas2d";
}

export interface RendererCaps {
  webgl2: boolean;
}

/**
 * Picks the best available FxRenderer backend.
 *
 * Order: WebGL2 → Canvas2D. WebGPU will slot in front when its renderer
 * is added (V2+). On context-creation failure (e.g. driver crash), the
 * factory silently falls back one tier — never throws.
 */
export function createFxRenderer(
  canvas: HTMLCanvasElement,
  caps: RendererCaps,
): FxRenderer {
  if (caps.webgl2) {
    try {
      return new WebGL2FxRenderer(canvas);
    } catch (err) {
      console.warn(
        "[fx] WebGL2 renderer init failed, falling back to Canvas2D:",
        err,
      );
    }
  }
  return new Canvas2DFxRenderer(canvas);
}
