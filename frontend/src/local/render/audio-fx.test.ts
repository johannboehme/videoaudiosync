import { describe, it, expect } from "vitest";
import { applyAudioOffset, applyDriftStretch } from "./audio-fx";

describe("applyAudioOffset", () => {
  const sr = 48000;
  const oneSecondTone = (() => {
    const n = sr;
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = i / n; // 0..1 ramp, easy to identify
    return buf;
  })();

  it("returns the input unchanged when offsetMs == 0", () => {
    const out = applyAudioOffset(oneSecondTone, sr, 0);
    expect(out).toBe(oneSecondTone);
  });

  it("prepends silence for positive offset (studio delayed)", () => {
    const out = applyAudioOffset(oneSecondTone, sr, 100); // 100ms
    expect(out.length).toBe(oneSecondTone.length + sr / 10);
    // First 100ms should be zero.
    for (let i = 0; i < sr / 10; i++) {
      expect(out[i]).toBe(0);
    }
    // Then the original signal follows.
    expect(out[sr / 10]).toBeCloseTo(0, 5);
    expect(out[sr / 10 + 100]).toBeCloseTo(100 / sr, 5);
  });

  it("trims from the start for negative offset (studio earlier than audio start)", () => {
    const out = applyAudioOffset(oneSecondTone, sr, -50); // -50ms
    expect(out.length).toBe(oneSecondTone.length - sr / 20);
    // First sample of out is what was at index sr/20 in input.
    expect(out[0]).toBeCloseTo((sr / 20) / sr, 5);
  });

  it("returns empty buffer if offset trims more than the length", () => {
    const tiny = new Float32Array([1, 2, 3]);
    const out = applyAudioOffset(tiny, sr, -10000); // way negative
    expect(out.length).toBe(0);
  });
});

describe("applyDriftStretch", () => {
  const sr = 48000;

  it("returns the input unchanged when driftRatio == 1.0", () => {
    const buf = new Float32Array([1, 2, 3, 4, 5]);
    const out = applyDriftStretch(buf, 1.0);
    expect(out).toBe(buf);
  });

  it("stretches the timeline by driftRatio (length grows for ratio > 1)", () => {
    // 1 second of constant 0.5 → at drift=1.01, output length = 1.01 * sr.
    const n = sr;
    const buf = new Float32Array(n).fill(0.5);
    const out = applyDriftStretch(buf, 1.01);
    expect(out.length).toBeCloseTo(n * 1.01, 0);
    // Constant input stays constant after resample.
    expect(out[Math.floor(out.length / 2)]).toBeCloseTo(0.5, 4);
  });

  it("compresses the timeline by driftRatio (length shrinks for ratio < 1)", () => {
    const n = sr;
    const buf = new Float32Array(n).fill(0.25);
    const out = applyDriftStretch(buf, 0.99);
    expect(out.length).toBeCloseTo(n * 0.99, 0);
    expect(out[Math.floor(out.length / 2)]).toBeCloseTo(0.25, 4);
  });

  it("preserves a linear ramp's shape (with linear interpolation)", () => {
    const n = 1000;
    const buf = new Float32Array(n);
    for (let i = 0; i < n; i++) buf[i] = i;
    const out = applyDriftStretch(buf, 1.5);
    expect(out.length).toBeCloseTo(n * 1.5, 0);
    // First and last samples preserved exactly.
    expect(out[0]).toBeCloseTo(0, 5);
    expect(out[out.length - 1]).toBeCloseTo(n - 1, 5);
    // Midpoint within ±1 sample-value of the analytical mid (allow for the
    // small skew introduced by mapping endpoints exactly: with N=1000 →
    // M=1500, the formal mid is at ~499.83).
    expect(out[Math.floor(out.length / 2)]).toBeCloseTo(n / 2, 0);
  });
});
