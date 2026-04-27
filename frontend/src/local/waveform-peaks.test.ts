import { describe, it, expect } from "vitest";
import { computeWaveformPeaks } from "./waveform-peaks";

describe("computeWaveformPeaks", () => {
  it("returns empty peaks for empty PCM", () => {
    const { peaks, duration } = computeWaveformPeaks(new Float32Array(0), 22050);
    expect(peaks).toEqual([]);
    expect(duration).toBe(0);
  });

  it("returns the requested number of buckets and a duration", () => {
    const sr = 22050;
    const n = sr * 2;
    const sig = new Float32Array(n);
    for (let i = 0; i < n; i++) sig[i] = Math.sin((2 * Math.PI * 440 * i) / sr);
    const { peaks, duration } = computeWaveformPeaks(sig, sr, 100);
    expect(peaks.length).toBe(100);
    expect(duration).toBeCloseTo(2.0, 3);
    // Sine signal: every bucket should span roughly [-1, 1].
    for (const [lo, hi] of peaks) {
      expect(lo).toBeLessThan(0);
      expect(hi).toBeGreaterThan(0);
    }
  });

  it("flat input gives [0, 0] peaks", () => {
    const sig = new Float32Array(22050).fill(0);
    const { peaks } = computeWaveformPeaks(sig, 22050, 50);
    for (const [lo, hi] of peaks) {
      expect(lo).toBe(0);
      expect(hi).toBe(0);
    }
  });
});
