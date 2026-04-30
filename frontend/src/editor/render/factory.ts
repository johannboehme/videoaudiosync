/**
 * Backend factory — picks the best available CompositorBackend for the
 * supplied capabilities. Mirrors the `createFxRenderer` factory pattern
 * in `editor/fx/render.ts`: try → catch → warn → fall through. Never
 * throws — the Canvas2DBackend always succeeds (it's the floor).
 *
 * Order: WebGPU → WebGL2 → Canvas2D. The WebGPU step is gated by
 * `EXPERIMENTAL_WEBGPU` (off by default) since the implementation is a
 * stub today. When a real WebGPU backend lands, flip the flag.
 */
import { Canvas2DBackend } from "./canvas2d-backend";
import { WebGL2Backend } from "./webgl2-backend";
import { WebGPUBackend } from "./webgpu-backend";
import type { BackendCaps, CompositorBackend } from "./backend";

export interface BackendCapabilities {
  webgl2: boolean;
  webgpu: boolean;
}

/** Set true to attempt the WebGPU backend before WebGL2. Default off
 *  while the WebGPU backend is a stub — flipping it without a real
 *  implementation would only burn a try/catch per session. */
export const EXPERIMENTAL_WEBGPU = false;

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export async function createBackend(
  canvas: AnyCanvas,
  caps: BackendCaps,
  capabilities: BackendCapabilities,
): Promise<CompositorBackend> {
  if (EXPERIMENTAL_WEBGPU && capabilities.webgpu) {
    try {
      const b = new WebGPUBackend();
      await b.init(canvas, caps);
      return b;
    } catch (err) {
      console.warn(
        "[compositor] WebGPU init failed, falling back to WebGL2:",
        err,
      );
    }
  }
  if (capabilities.webgl2) {
    try {
      const b = new WebGL2Backend();
      await b.init(canvas, caps);
      return b;
    } catch (err) {
      console.warn(
        "[compositor] WebGL2 init failed, falling back to Canvas2D:",
        err,
      );
    }
  }
  const b = new Canvas2DBackend();
  await b.init(canvas, caps);
  return b;
}
