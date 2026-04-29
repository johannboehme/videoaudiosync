import { describe, it, expect } from "vitest";
import { computeOutputFrameBox, resolveOutputAspectRatio } from "./output-frame";

describe("computeOutputFrameBox", () => {
  it("returns full container when AR matches container", () => {
    const box = computeOutputFrameBox(16 / 9, { width: 1600, height: 900 });
    expect(box).toEqual({ left: 0, top: 0, width: 1600, height: 900 });
  });

  it("letterboxes top/bottom when output is wider than container", () => {
    // 16:9 output (≈1.777) in a 16:10 (1.6) container → letterbox.
    const box = computeOutputFrameBox(16 / 9, { width: 1600, height: 1000 });
    expect(box.left).toBe(0);
    expect(box.width).toBe(1600);
    expect(box.height).toBeCloseTo(900, 6);
    expect(box.top).toBeCloseTo(50, 6);
  });

  it("pillarboxes left/right when output is taller than container", () => {
    // 9:16 output (0.5625) in a 16:9 (1.777) container → pillarbox.
    const box = computeOutputFrameBox(9 / 16, { width: 1600, height: 900 });
    expect(box.top).toBe(0);
    expect(box.height).toBe(900);
    expect(box.width).toBeCloseTo(506.25, 4);
    expect(box.left).toBeCloseTo((1600 - 506.25) / 2, 4);
  });

  it("returns zero-area for zero container", () => {
    expect(computeOutputFrameBox(16 / 9, { width: 0, height: 0 })).toEqual({
      left: 0,
      top: 0,
      width: 0,
      height: 0,
    });
  });

  it("returns full container for non-positive AR", () => {
    expect(
      computeOutputFrameBox(0, { width: 100, height: 50 }),
    ).toEqual({ left: 0, top: 0, width: 100, height: 50 });
  });
});

describe("resolveOutputAspectRatio", () => {
  it("prefers explicit resolution over cam-1 natural", () => {
    const ar = resolveOutputAspectRatio({
      resolution: { w: 1920, h: 1080 },
      cam1NaturalAR: 9 / 16,
    });
    expect(ar).toBeCloseTo(16 / 9, 6);
  });

  it('falls back to cam-1 natural for "source" resolution', () => {
    const ar = resolveOutputAspectRatio({
      resolution: "source",
      cam1NaturalAR: 9 / 16,
    });
    expect(ar).toBeCloseTo(9 / 16, 6);
  });

  it("falls back to cam-1 natural when resolution undefined", () => {
    const ar = resolveOutputAspectRatio({
      resolution: undefined,
      cam1NaturalAR: 1.5,
    });
    expect(ar).toBe(1.5);
  });

  it("returns null when nothing is known", () => {
    expect(
      resolveOutputAspectRatio({ resolution: "source", cam1NaturalAR: null }),
    ).toBeNull();
  });
});
