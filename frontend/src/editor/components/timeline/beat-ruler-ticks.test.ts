import { describe, expect, it } from "vitest";
import { buildRulerTicks } from "./beat-ruler-ticks";

const BPM = 120;        // 0.5 s per beat, 2 s per bar (4/4)
const PHASE = 0;

describe("buildRulerTicks — visibility tied to zoom", () => {
  it("at low zoom, only bars are emitted", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: PHASE,
      startS: 0,
      endS: 8,
      pxPerSec: 3, // 0.5 s × 3 = 1.5 px per beat → bars only
    });
    const kinds = new Set(ticks.map((t) => t.kind));
    expect(kinds).toEqual(new Set(["bar"]));
    // 4 bars in [0, 8] s at BPM=120 (bar = 2 s) → ticks at 0, 2, 4, 6, 8
    expect(ticks.map((t) => t.t)).toEqual([0, 2, 4, 6, 8]);
  });

  it("at medium zoom, bars + beats but no subdivisions", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: PHASE,
      startS: 0,
      endS: 4,
      pxPerSec: 30, // 0.5 s × 30 = 15 px/beat → bars+beats only
    });
    const kinds = new Set(ticks.map((t) => t.kind));
    expect(kinds.has("bar")).toBe(true);
    expect(kinds.has("beat")).toBe(true);
    expect(kinds.has("div8")).toBe(false);
    expect(kinds.has("div16")).toBe(false);
  });

  it("at high zoom, subdivisions to 1/8 appear", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: PHASE,
      startS: 0,
      endS: 1,
      pxPerSec: 80, // 0.5 s × 80 = 40 px/beat → +div8
    });
    const kinds = new Set(ticks.map((t) => t.kind));
    expect(kinds.has("div8")).toBe(true);
    expect(kinds.has("div16")).toBe(false);
  });

  it("at very high zoom, 1/16 subdivisions appear", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: PHASE,
      startS: 0,
      endS: 0.5,
      pxPerSec: 200, // 0.5 s × 200 = 100 px/beat → +div8 +div16
    });
    const kinds = new Set(ticks.map((t) => t.kind));
    expect(kinds.has("div16")).toBe(true);
  });

  it("respects beatPhase offset (beat 0 sits at the phase, not at 0)", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: 0.1,
      startS: 0,
      endS: 1.2,
      pxPerSec: 30,
    });
    const beats = ticks.filter((t) => t.kind === "beat" || t.kind === "bar");
    // First detectable beat is at 0.1 s, then 0.6 s, 1.1 s.
    expect(beats[0].t).toBeCloseTo(0.1, 6);
    expect(beats[1].t).toBeCloseTo(0.6, 6);
    expect(beats[2].t).toBeCloseTo(1.1, 6);
  });

  it("emits sequential bar numbers starting at 1 from beatPhase", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: PHASE,
      startS: 0,
      endS: 8,
      pxPerSec: 30,
    });
    const bars = ticks.filter((t) => t.kind === "bar");
    expect(bars[0].barNumber).toBe(1);
    expect(bars[1].barNumber).toBe(2);
    expect(bars[2].barNumber).toBe(3);
    // 4 bars at 0, 2, 4, 6 → barNumber 1..4 (8 itself = bar 5)
    expect(bars[bars.length - 1].barNumber).toBe(5);
  });

  it("clips to [startS, endS]", () => {
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: PHASE,
      startS: 4,
      endS: 6,
      pxPerSec: 30,
    });
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.t).toBeGreaterThanOrEqual(4);
      expect(t.t).toBeLessThanOrEqual(6);
    }
  });

  it("does not draw any pre-phase ticks (intro silence stays empty)", () => {
    // The master audio leads with ~0.93 s of silence before the music
    // starts. Bar 1 must land on the first real beat — no negative-bar /
    // pre-phase ticks should appear in the silent intro.
    const ticks = buildRulerTicks({
      bpm: BPM,
      beatPhase: 0.928,
      startS: 0,
      endS: 5,
      pxPerSec: 100, // ample zoom — every kind is enabled
    });
    expect(ticks.length).toBeGreaterThan(0);
    for (const t of ticks) {
      expect(t.t).toBeGreaterThanOrEqual(0.928 - 1e-9);
    }
    const bars = ticks.filter((t) => t.kind === "bar");
    expect(bars[0].t).toBeCloseTo(0.928, 6);
    expect(bars[0].barNumber).toBe(1);
  });

  it("returns empty for invalid bpm (null/zero/negative)", () => {
    for (const bpm of [null as unknown as number, 0, -120]) {
      expect(
        buildRulerTicks({ bpm, beatPhase: 0, startS: 0, endS: 4, pxPerSec: 30 }),
      ).toEqual([]);
    }
  });
});
