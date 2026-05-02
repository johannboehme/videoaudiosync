/**
 * Backend factory — picks the best available CompositorBackend for the
 * supplied capabilities. Strict ladder: WebGPU → WebGL2 → Canvas2D.
 *
 * `capabilities.webgpu === true` is treated as a hard guarantee that
 * the WebGPU backend will succeed. The caller (`probeWebGPU()` in
 * `local/capabilities.ts`) is responsible for ensuring this — a
 * `requestAdapter() → null` host must report `webgpu: false` so we
 * never reach the WebGPU branch on a platform that can't run it.
 *
 * WebGL2 keeps a try/catch fallback because jsdom's
 * `getContext('webgl2')` returns null even when the host probe (in a
 * real browser) said it was available — that branch handles unit
 * tests that exercise the factory under jsdom.
 */
import { Canvas2DBackend } from "./canvas2d-backend";
import { WebGL2Backend } from "./webgl2-backend";
import { WebGPUBackend } from "./webgpu-backend";
import type { BackendCaps, CompositorBackend } from "./backend";

export interface BackendCapabilities {
  webgl2: boolean;
  webgpu: boolean;
}

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

export async function createBackend(
  canvas: AnyCanvas,
  caps: BackendCaps,
  capabilities: BackendCapabilities,
): Promise<CompositorBackend> {
  if (capabilities.webgpu) {
    const b = new WebGPUBackend();
    await b.init(canvas, caps);
    return b;
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
