/**
 * WebGPU compositor backend — STUB.
 *
 * Phase 2 ships the backend interface and factory ladder ready for a
 * real WebGPU implementation, but the implementation itself is
 * deliberately deferred to a follow-up:
 *
 *   - `Capabilities.webgpu` today is just `"gpu" in navigator` — that
 *     isn't usable as a real signal. Real detection needs an async
 *     `navigator.gpu.requestAdapter()` handshake that can return null
 *     even when `navigator.gpu` exists (Linux / FF cases).
 *   - Adding a third real backend would triple the parity test matrix
 *     and slow the migration of the preview onto the new pipeline.
 *   - The factory pattern (try → catch → log → next tier) means a real
 *     WebGPU backend can land in a follow-up with zero changes to
 *     PreviewRuntime, Compositor.tsx, the descriptor builder, or the
 *     export pipeline.
 *
 * So we always throw on init, the factory always falls through to
 * WebGL2 (or Canvas2D), and the rest of the system is none the wiser.
 * When a real implementation lands it replaces this file body and
 * everything else keeps working.
 */
import type {
  BackendCaps,
  CompositorBackend,
  SourcesMap,
} from "./backend";
import { BackendError } from "./backend";
import type { FrameDescriptor } from "./frame-descriptor";

export class WebGPUBackend implements CompositorBackend {
  readonly id = "webgpu" as const;

  async init(_canvas: HTMLCanvasElement | OffscreenCanvas, _caps: BackendCaps): Promise<void> {
    throw new BackendError(
      "init",
      "WebGPUBackend: not implemented yet — factory will fall back to WebGL2",
    );
  }

  resize(_caps: BackendCaps): void {
    // Unreachable — init always throws.
  }

  warmup(): Promise<void> {
    return Promise.resolve();
  }

  drawFrame(_descriptor: FrameDescriptor, _sources: SourcesMap): void {
    // Unreachable — init always throws.
  }

  dispose(): void {
    // Unreachable — init always throws.
  }
}
