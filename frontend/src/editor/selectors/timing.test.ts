import { describe, it, expect } from "vitest";
import {
  effectiveBeatPhaseS,
  effectiveAudioStartS,
  effectiveBeatsPerBar,
  effectiveBarOffsetBeats,
  effectiveBarPhaseS,
} from "./timing";
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

describe("effectiveBeatsPerBar", () => {
  it("defaults to 4 when meta is null/undefined or missing", () => {
    expect(effectiveBeatsPerBar(null)).toBe(4);
    expect(effectiveBeatsPerBar(undefined)).toBe(4);
    expect(effectiveBeatsPerBar(baseMeta)).toBe(4);
  });

  it("returns the user-set value", () => {
    expect(effectiveBeatsPerBar({ ...baseMeta, beatsPerBar: 3 })).toBe(3);
    expect(effectiveBeatsPerBar({ ...baseMeta, beatsPerBar: 7 })).toBe(7);
  });

  it("clamps to >= 1 (defensive — invalid stored value falls back to 4)", () => {
    expect(effectiveBeatsPerBar({ ...baseMeta, beatsPerBar: 0 })).toBe(4);
    expect(effectiveBeatsPerBar({ ...baseMeta, beatsPerBar: -2 })).toBe(4);
  });
});

describe("effectiveBarOffsetBeats", () => {
  it("defaults to 0 when meta is null/undefined or missing", () => {
    expect(effectiveBarOffsetBeats(null)).toBe(0);
    expect(effectiveBarOffsetBeats(undefined)).toBe(0);
    expect(effectiveBarOffsetBeats(baseMeta)).toBe(0);
  });

  it("returns the user-set value", () => {
    expect(
      effectiveBarOffsetBeats({ ...baseMeta, barOffsetBeats: 2 }),
    ).toBe(2);
  });

  it("normalises into [0, beatsPerBar) so the offset is canonical", () => {
    // pickup = 5 in 4/4 is the same as pickup = 1.
    expect(
      effectiveBarOffsetBeats({
        ...baseMeta,
        beatsPerBar: 4,
        barOffsetBeats: 5,
      }),
    ).toBe(1);
    // negative pickup wraps into the positive range.
    expect(
      effectiveBarOffsetBeats({
        ...baseMeta,
        beatsPerBar: 4,
        barOffsetBeats: -1,
      }),
    ).toBe(3);
  });
});

describe("effectiveBarPhaseS", () => {
  const meta120: JobMeta = {
    ...baseMeta,
    bpm: { value: 120, confidence: 1, phase: 0.5, manualOverride: false },
  };

  it("equals the beat phase when there is no pickup", () => {
    expect(effectiveBarPhaseS(meta120)).toBeCloseTo(0.5, 6);
  });

  it("shifts forward by `barOffsetBeats * beatPeriod` when there is a pickup", () => {
    // 120 BPM → period = 0.5 s. Pickup = 2 beats → bar 1 sits 1.0 s after beat 0.
    expect(
      effectiveBarPhaseS({ ...meta120, barOffsetBeats: 2 }),
    ).toBeCloseTo(1.5, 6);
  });

  it("returns 0 when bpm is missing (no period to shift)", () => {
    expect(effectiveBarPhaseS({ ...baseMeta, barOffsetBeats: 2 })).toBe(0);
  });

  it("includes the audio-start nudge (rides on top of beatPhase)", () => {
    expect(
      effectiveBarPhaseS({
        ...meta120,
        barOffsetBeats: 1,
        audioStartNudgeS: 0.030,
      }),
    ).toBeCloseTo(0.5 + 0.030 + 0.5, 6);
  });
});
