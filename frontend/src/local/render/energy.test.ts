import { describe, it, expect } from "vitest";
import { computeEnergyCurves, BANDS_HZ } from "./energy";

describe("computeEnergyCurves", () => {
  it("returns empty curves for empty input", () => {
    const out = computeEnergyCurves(new Float32Array(0), 22050, 30);
    expect(out.frames).toBe(0);
    expect(Object.keys(out.bands)).toEqual([]);
  });

  it("returns one entry per declared band", () => {
    const sr = 22050;
    const n = sr * 2; // 2 sec
    const sig = new Float32Array(n);
    // Pure sine at 100 Hz → bass band should dominate.
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sr);

    const out = computeEnergyCurves(sig, sr, 30);
    expect(Object.keys(out.bands).sort()).toEqual(Object.keys(BANDS_HZ).sort());
  });

  it("100 Hz sine concentrates energy in the bass band", () => {
    const sr = 22050;
    const n = sr * 2;
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 100 * i) / sr);
    const out = computeEnergyCurves(sig, sr, 30);

    const mid = Math.floor(out.frames / 2);
    expect(out.bands.bass[mid]).toBeGreaterThan(0.5);
    // Mids/highs should be much smaller (numerical leakage only).
    expect(out.bands.mids[mid]).toBeLessThan(0.5);
    expect(out.bands.highs[mid]).toBeLessThan(0.5);
  });

  it("5000 Hz sine concentrates energy in the highs band", () => {
    const sr = 22050;
    const n = sr * 2;
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 5000 * i) / sr);
    const out = computeEnergyCurves(sig, sr, 30);

    const mid = Math.floor(out.frames / 2);
    expect(out.bands.highs[mid]).toBeGreaterThan(0.5);
    expect(out.bands.bass[mid]).toBeLessThan(0.5);
  });

  it("each band's max value is exactly 1 after normalization", () => {
    const sr = 22050;
    const n = sr * 2;
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / sr);
    const out = computeEnergyCurves(sig, sr, 30);

    for (const [name, values] of Object.entries(out.bands)) {
      if (values.length === 0) continue;
      const max = Math.max(...values);
      expect(max, `band=${name}`).toBeCloseTo(1.0, 4);
    }
  });

  it("frame count is consistent with fps", () => {
    const sr = 22050;
    const durationS = 3.0;
    const n = Math.round(sr * durationS);
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = 0.1 * Math.sin((2 * Math.PI * 440 * i) / sr);
    const out = computeEnergyCurves(sig, sr, 30);
    // ~3 sec at 30 fps = ~90 frames (centered framing pads on both sides).
    expect(out.frames).toBeGreaterThan(80);
    expect(out.frames).toBeLessThan(100);
  });
});
