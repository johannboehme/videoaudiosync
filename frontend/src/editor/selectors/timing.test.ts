import { describe, it, expect } from "vitest";
import { effectiveBeatPhaseS, effectiveAudioStartS } from "./timing";
import type { JobMeta } from "../store";

const baseMeta: JobMeta = {
  id: "j",
  fps: 30,
  duration: 10,
  width: 1920,
  height: 1080,
  algoOffsetMs: 0,
  driftRatio: 1,
};

describe("effectiveBeatPhaseS", () => {
  it("returns 0 for null/undefined meta", () => {
    expect(effectiveBeatPhaseS(null)).toBe(0);
    expect(effectiveBeatPhaseS(undefined)).toBe(0);
  });

  it("returns 0 when bpm is missing", () => {
    expect(effectiveBeatPhaseS(baseMeta)).toBe(0);
  });

  it("returns raw phase when nudge is unset", () => {
    const meta: JobMeta = {
      ...baseMeta,
      bpm: { value: 120, confidence: 1, phase: 0.5, manualOverride: false },
    };
    expect(effectiveBeatPhaseS(meta)).toBe(0.5);
  });

  it("adds nudge to phase", () => {
    const meta: JobMeta = {
      ...baseMeta,
      bpm: { value: 120, confidence: 1, phase: 0.5, manualOverride: false },
      audioStartNudgeS: 0.012,
    };
    expect(effectiveBeatPhaseS(meta)).toBeCloseTo(0.512, 6);
  });

  it("supports negative (signed) nudge", () => {
    const meta: JobMeta = {
      ...baseMeta,
      bpm: { value: 120, confidence: 1, phase: 0.5, manualOverride: false },
      audioStartNudgeS: -0.020,
    };
    expect(effectiveBeatPhaseS(meta)).toBeCloseTo(0.48, 6);
  });

  it("does not constrain nudge to ±period/2 (anchor invariant only initial)", () => {
    // 120 BPM → period = 0.5s. Nudge of 1.0s is allowed; phase drifts freely.
    const meta: JobMeta = {
      ...baseMeta,
      bpm: { value: 120, confidence: 1, phase: 0.5, manualOverride: false },
      audioStartNudgeS: 1.0,
    };
    expect(effectiveBeatPhaseS(meta)).toBeCloseTo(1.5, 6);
  });

  it("treats nudge=0 same as missing nudge", () => {
    const meta: JobMeta = {
      ...baseMeta,
      bpm: { value: 120, confidence: 1, phase: 0.5, manualOverride: false },
      audioStartNudgeS: 0,
    };
    expect(effectiveBeatPhaseS(meta)).toBe(0.5);
  });
});

describe("effectiveAudioStartS", () => {
  it("returns 0 for null/undefined meta", () => {
    expect(effectiveAudioStartS(null)).toBe(0);
    expect(effectiveAudioStartS(undefined)).toBe(0);
  });

  it("returns 0 when audioStartS is unset", () => {
    expect(effectiveAudioStartS(baseMeta)).toBe(0);
  });

  it("returns raw audioStartS when nudge is unset", () => {
    expect(effectiveAudioStartS({ ...baseMeta, audioStartS: 1.25 })).toBe(1.25);
  });

  it("adds nudge to audioStartS", () => {
    expect(
      effectiveAudioStartS({
        ...baseMeta,
        audioStartS: 1.25,
        audioStartNudgeS: 0.015,
      }),
    ).toBeCloseTo(1.265, 6);
  });

  it("supports negative nudge", () => {
    expect(
      effectiveAudioStartS({
        ...baseMeta,
        audioStartS: 1.25,
        audioStartNudgeS: -0.05,
      }),
    ).toBeCloseTo(1.20, 6);
  });
});
