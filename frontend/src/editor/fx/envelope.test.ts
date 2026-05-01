import { describe, it, expect } from "vitest";
import { envelopeAt, INSTANT_ENVELOPE, type ADSREnvelope } from "./envelope";

const env = (
  attackS: number,
  decayS: number,
  sustain: number,
  releaseS: number,
): ADSREnvelope => ({ attackS, decayS, sustain, releaseS });

describe("envelopeAt — attack phase", () => {
  it("rises 0→1 linearly during the attack window", () => {
    const e = env(0.1, 0, 1, 0);
    expect(envelopeAt(e, 1.0, 0)).toBeCloseTo(0, 6);
    expect(envelopeAt(e, 1.0, 0.05)).toBeCloseTo(0.5, 6);
    expect(envelopeAt(e, 1.0, 0.099)).toBeCloseTo(0.99, 2);
  });

  it("returns 1 immediately when attack is 0", () => {
    expect(envelopeAt(env(0, 0, 1, 0), 1.0, 0)).toBe(1);
  });
});

describe("envelopeAt — decay phase", () => {
  it("falls 1→sustain linearly during the decay window", () => {
    const e = env(0.01, 0.02, 0.6, 0);
    // localT = A (start of decay) → exactly 1
    expect(envelopeAt(e, 1.0, 0.01)).toBeCloseTo(1, 6);
    // localT = A + D/2 → halfway between 1 and S
    expect(envelopeAt(e, 1.0, 0.02)).toBeCloseTo(0.8, 6);
    // localT = A + D → exactly S (read in sustain phase)
    expect(envelopeAt(e, 1.0, 0.03)).toBeCloseTo(0.6, 6);
  });

  it("snaps to sustain when decay is 0", () => {
    const e = env(0.01, 0, 0.5, 0);
    expect(envelopeAt(e, 1.0, 0.05)).toBeCloseTo(0.5, 6);
  });
});

describe("envelopeAt — sustain phase", () => {
  it("holds sustain level between decay-end and release-start", () => {
    const e = env(0.05, 0.1, 0.7, 0.2);
    // regionDur=1: sustain runs 0.15 .. 0.8
    expect(envelopeAt(e, 1.0, 0.3)).toBeCloseTo(0.7, 6);
    expect(envelopeAt(e, 1.0, 0.5)).toBeCloseTo(0.7, 6);
    expect(envelopeAt(e, 1.0, 0.79)).toBeCloseTo(0.7, 6);
  });
});

describe("envelopeAt — release phase", () => {
  it("falls sustain→0 linearly across the release window", () => {
    const e = env(0, 0, 1, 0.2);
    // releaseStart = 1.0 - 0.2 = 0.8
    expect(envelopeAt(e, 1.0, 0.8)).toBeCloseTo(1, 6);
    expect(envelopeAt(e, 1.0, 0.9)).toBeCloseTo(0.5, 6);
    expect(envelopeAt(e, 1.0, 0.99)).toBeCloseTo(0.05, 2);
  });

  it("respects sustain level at start of release", () => {
    const e = env(0, 0, 0.4, 0.2);
    expect(envelopeAt(e, 1.0, 0.8)).toBeCloseTo(0.4, 6);
    expect(envelopeAt(e, 1.0, 0.9)).toBeCloseTo(0.2, 6);
  });
});

describe("envelopeAt — edge cases", () => {
  it("returns 0 when regionDurS is 0", () => {
    expect(envelopeAt(env(0.1, 0.1, 0.5, 0.1), 0, 0)).toBe(0);
  });

  it("returns 0 when localT >= regionDurS", () => {
    expect(envelopeAt(env(0, 0, 1, 0), 1.0, 1.0)).toBe(0);
    expect(envelopeAt(env(0, 0, 1, 0), 1.0, 1.5)).toBe(0);
  });

  it("compresses A+D to fit (region - R), keeping the release tail intact", () => {
    // After release: regionDur = held + R. If A+D > held, A+D compress
    // to fit `held`; R stays exactly R so the user's release fade plays
    // out unmodified.
    const e = env(0.1, 0, 1, 0.2);
    const regionDur = 0.05 + 0.2; // held 50 ms + R=200 ms = 250 ms
    // Mid-attack at 25 ms — A is compressed to 50 ms, so 25 ms is half.
    expect(envelopeAt(e, regionDur, 0.025)).toBeCloseTo(0.5, 4);
    // At the snapped release moment (50 ms): peak, release just starting.
    expect(envelopeAt(e, regionDur, 0.05)).toBeCloseTo(1, 4);
    // Halfway through release: 50 ms + 100 ms = 150 ms → wetness 0.5.
    expect(envelopeAt(e, regionDur, 0.15)).toBeCloseTo(0.5, 4);
  });

  it("clamps R alone when even R exceeds the region (sub-R sliver)", () => {
    // 100 ms region but R=200 → R clamps to 100, A/D zeroed.
    const e = env(0.1, 0.05, 0.5, 0.2);
    expect(envelopeAt(e, 0.1, 0)).toBeCloseTo(0.5, 5);
    expect(envelopeAt(e, 0.1, 0.05)).toBeCloseTo(0.25, 5);
    expect(envelopeAt(e, 0.1, 0.099)).toBeCloseTo(0.005, 3);
  });

  it("clamps sustain level into [0, 1]", () => {
    expect(envelopeAt(env(0, 0, 1.5, 0), 1.0, 0.5)).toBe(1);
    expect(envelopeAt(env(0, 0, -0.5, 0), 1.0, 0.5)).toBe(0);
  });

  it("never returns NaN even with extreme values", () => {
    const samples = [0, 0.1, 0.25, 0.5, 0.75, 0.9, 1.0];
    for (const t of samples) {
      const v = envelopeAt(env(0, 0, 0, 0), 1.0, t);
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("envelopeAt — INSTANT_ENVELOPE default", () => {
  it("returns 1 for any localT in [0, regionDur)", () => {
    expect(envelopeAt(INSTANT_ENVELOPE, 1.0, 0)).toBe(1);
    expect(envelopeAt(INSTANT_ENVELOPE, 1.0, 0.5)).toBe(1);
    expect(envelopeAt(INSTANT_ENVELOPE, 1.0, 0.999)).toBe(1);
  });

  it("returns 0 at outS exclusive boundary", () => {
    expect(envelopeAt(INSTANT_ENVELOPE, 1.0, 1.0)).toBe(0);
  });

  it("matches the previous hard-edge semantics bit-for-bit", () => {
    // INSTANT keeps existing behavior: full effect throughout, hard cut at outS.
    expect(INSTANT_ENVELOPE.attackS).toBe(0);
    expect(INSTANT_ENVELOPE.decayS).toBe(0);
    expect(INSTANT_ENVELOPE.sustain).toBe(1);
    expect(INSTANT_ENVELOPE.releaseS).toBe(0);
  });
});
