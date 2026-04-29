import { describe, it, expect, vi } from "vitest";
import { Canvas2DFxRenderer } from "./canvas2d-renderer";
import type { PunchFx } from "./types";

/**
 * jsdom doesn't ship a real Canvas2D context, so we stub `getContext` on
 * the canvas to return a hand-rolled mock that records the calls we care
 * about. The renderer's job is to:
 *  - clearRect(0,0,w,h) on every render
 *  - save/restore around each fx draw
 *  - call the catalog's drawCanvas2D (visible via fillRect / fillStyle)
 */
function makeMockCanvas(): {
  canvas: HTMLCanvasElement;
  ctx: {
    clearRect: ReturnType<typeof vi.fn>;
    save: ReturnType<typeof vi.fn>;
    restore: ReturnType<typeof vi.fn>;
    fillRect: ReturnType<typeof vi.fn>;
    createRadialGradient: ReturnType<typeof vi.fn>;
    setTransform: ReturnType<typeof vi.fn>;
    fillStyle: unknown;
  };
} {
  const ctx = {
    clearRect: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    fillRect: vi.fn(),
    createRadialGradient: vi.fn(() => ({
      addColorStop: vi.fn(),
    })),
    setTransform: vi.fn(),
    fillStyle: "" as unknown,
  };
  const canvas = document.createElement("canvas");
  // Stub getContext on this canvas instance only.
  (canvas as unknown as { getContext: () => typeof ctx }).getContext = () => ctx;
  return { canvas, ctx };
}

const fx = (id: string, inS: number, outS: number): PunchFx => ({
  id,
  kind: "vignette",
  inS,
  outS,
});

describe("Canvas2DFxRenderer", () => {
  it("reports its backend", () => {
    const { canvas } = makeMockCanvas();
    const r = new Canvas2DFxRenderer(canvas);
    expect(r.backend).toBe("canvas2d");
  });

  it("clears the canvas on every render", () => {
    const { canvas, ctx } = makeMockCanvas();
    const r = new Canvas2DFxRenderer(canvas);
    r.resize(100, 50, 1);
    r.render(0, []);
    expect(ctx.clearRect).toHaveBeenCalled();
  });

  it("does no fx draws when active list is empty", () => {
    const { canvas, ctx } = makeMockCanvas();
    const r = new Canvas2DFxRenderer(canvas);
    r.resize(100, 50, 1);
    r.render(0, []);
    expect(ctx.save).not.toHaveBeenCalled();
    expect(ctx.fillRect).not.toHaveBeenCalled();
  });

  it("wraps each fx in save/restore (paired)", () => {
    const { canvas, ctx } = makeMockCanvas();
    const r = new Canvas2DFxRenderer(canvas);
    r.resize(100, 50, 1);
    r.render(0, [fx("a", 0, 1), fx("b", 0, 1)]);
    expect(ctx.save).toHaveBeenCalledTimes(2);
    expect(ctx.restore).toHaveBeenCalledTimes(2);
  });

  it("issues a fillRect per active fx (vignette)", () => {
    const { canvas, ctx } = makeMockCanvas();
    const r = new Canvas2DFxRenderer(canvas);
    r.resize(100, 50, 1);
    r.render(0, [fx("a", 0, 1)]);
    // Vignette draws a single fillRect covering the surface.
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 100, 50);
  });

  it("scales by DPR via setTransform once per resize", () => {
    const { canvas, ctx } = makeMockCanvas();
    const r = new Canvas2DFxRenderer(canvas);
    r.resize(100, 50, 2);
    expect(canvas.width).toBe(200);
    expect(canvas.height).toBe(100);
    expect(ctx.setTransform).toHaveBeenLastCalledWith(2, 0, 0, 2, 0, 0);
  });
});
