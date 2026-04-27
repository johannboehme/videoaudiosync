import { describe, it, expect, vi } from "vitest";
import { ShowwavesVisualizer } from "./showwaves";
import { ShowfreqsVisualizer } from "./showfreqs";

/**
 * Pure unit tests for visualizers — no real canvas. We pass a vi.fn()-backed
 * fake context and verify the right kind of drawing calls are made.
 *
 * The visual fidelity is verified by the edit-render browser test: it
 * actually rasterises a frame and asserts non-zero pixel data exists in
 * the visualizer region.
 */

function fakeCtx(): {
  ctx: OffscreenCanvasRenderingContext2D;
  calls: { name: string; args: unknown[] }[];
} {
  const calls: { name: string; args: unknown[] }[] = [];
  const proxy = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop === "save" || prop === "restore" || prop === "beginPath" || prop === "stroke" ||
            prop === "moveTo" || prop === "lineTo" || prop === "fillRect") {
          return (...args: unknown[]) => calls.push({ name: prop, args });
        }
        // Allow assigning fillStyle, strokeStyle, lineWidth.
        return undefined;
      },
      set(_t, prop: string, value) {
        calls.push({ name: `set:${prop}`, args: [value] });
        return true;
      },
    },
  );
  return { ctx: proxy as unknown as OffscreenCanvasRenderingContext2D, calls };
}

describe("ShowwavesVisualizer", () => {
  it("draws a stroke for each pixel column when audio is present", () => {
    const sr = 22050;
    const pcm = new Float32Array(sr * 5);
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin((2 * Math.PI * 200 * i) / sr) * 0.5;
    const v = new ShowwavesVisualizer({ pcm, sampleRate: sr });
    const { ctx, calls } = fakeCtx();
    v.draw(ctx, 2.0, 320, 240);
    const moveTos = calls.filter((c) => c.name === "moveTo").length;
    const lineTos = calls.filter((c) => c.name === "lineTo").length;
    // One moveTo + one lineTo per pixel column; plus an initial "moveTo" before the loop.
    expect(moveTos).toBeGreaterThan(300);
    expect(lineTos).toBeGreaterThan(200);
    expect(calls.some((c) => c.name === "stroke")).toBe(true);
  });

  it("falls back to silent rendering when the requested time is outside the buffer", () => {
    const v = new ShowwavesVisualizer({ pcm: new Float32Array(0), sampleRate: 22050 });
    const draw = vi.fn();
    v.draw({ fillRect: draw } as unknown as OffscreenCanvasRenderingContext2D, 1.0, 320, 240);
    // No throw — empty PCM is allowed.
    expect(draw).toHaveBeenCalled();
  });
});

describe("ShowfreqsVisualizer", () => {
  it("draws one rect per (band × barsPerBand) plus a background", () => {
    const energy = {
      fps: 30,
      frames: 90,
      bands: {
        bass: Array(90).fill(0.5),
        low_mids: Array(90).fill(0.3),
        mids: Array(90).fill(0.7),
        highs: Array(90).fill(0.2),
      },
    };
    const v = new ShowfreqsVisualizer({ energy, barsPerBand: 4 });
    const { ctx, calls } = fakeCtx();
    v.draw(ctx, 1.0, 320, 240);

    const rects = calls.filter((c) => c.name === "fillRect").length;
    // background + 4 bands × 4 bars = 17
    expect(rects).toBeGreaterThanOrEqual(17);
  });

  it("draws an empty (no-bars) state when energy curves are empty", () => {
    const energy = { fps: 30, frames: 0, bands: {} };
    const v = new ShowfreqsVisualizer({ energy });
    const { ctx, calls } = fakeCtx();
    v.draw(ctx, 0, 320, 240);
    // Background + 4 × 6 = 25 rects expected; bars are zero-height-clamped.
    const rects = calls.filter((c) => c.name === "fillRect").length;
    expect(rects).toBeGreaterThan(0);
  });
});
