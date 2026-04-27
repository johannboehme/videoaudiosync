/**
 * Visualizer interface — one draw call per output frame.
 *
 * The compositor calls `draw(ctx, t, w, h)` after painting the source
 * frame and before subtitle burn-in. The visualizer is responsible for
 * any compositing of its own (alpha, blend mode, transparent regions).
 *
 * Each visualizer owns its source data (PCM, energy curves, etc.) — the
 * compositor doesn't pass it in per-frame. This keeps the composite hot
 * path tight and lets the visualizer pre-compute whatever it needs.
 */

export interface Visualizer {
  /**
   * Paint this visualizer's contribution at time `t` (seconds since the
   * start of the *output* video) onto the given context. The context's
   * canvas is `w × h` pixels.
   */
  draw(ctx: OffscreenCanvasRenderingContext2D, t: number, w: number, h: number): void;
}
