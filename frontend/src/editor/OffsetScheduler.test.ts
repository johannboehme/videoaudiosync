import { describe, expect, test } from "vitest";
import {
  computeAudioStartOffset,
  clampLoopRegion,
  shouldRescheduleOnTick,
} from "./OffsetScheduler";

describe("computeAudioStartOffset", () => {
  test("zero offset → audio starts where the video time is", () => {
    expect(computeAudioStartOffset({ videoTime: 1.5, totalOffsetMs: 0 })).toBe(1.5);
  });

  test("positive offset (audio should lag video) → start audio earlier in the buffer", () => {
    // Video plays t=2.0; user wants studio to lag by 200ms so the studio sample
    // at t=1.8 is heard at video=2.0.
    expect(
      computeAudioStartOffset({ videoTime: 2.0, totalOffsetMs: 200 }),
    ).toBeCloseTo(1.8, 6);
  });

  test("negative offset (audio leads video) → start audio later in the buffer", () => {
    expect(
      computeAudioStartOffset({ videoTime: 1.0, totalOffsetMs: -150 }),
    ).toBeCloseTo(1.15, 6);
  });

  test("clamps to 0 when computed start would be negative", () => {
    // If videoTime=0.05 and offset=200ms, naive math gives -0.15 — must clamp.
    expect(
      computeAudioStartOffset({ videoTime: 0.05, totalOffsetMs: 200 }),
    ).toBe(0);
  });

  test("returns null when start would exceed audio duration", () => {
    expect(
      computeAudioStartOffset({
        videoTime: 5.0,
        totalOffsetMs: -2000,
        audioDuration: 6.0,
      }),
    ).toBeNull(); // 5 + 2 = 7 > 6
  });

  test("respects audioDuration when given and start is in range", () => {
    expect(
      computeAudioStartOffset({
        videoTime: 5.0,
        totalOffsetMs: 0,
        audioDuration: 6.0,
      }),
    ).toBe(5.0);
  });
});

describe("clampLoopRegion", () => {
  test("loop fully inside trim is unchanged", () => {
    expect(
      clampLoopRegion({ start: 1, end: 2 }, { in: 0, out: 5 }),
    ).toEqual({ start: 1, end: 2 });
  });

  test("loop extending past trim end is clipped to trim end", () => {
    expect(
      clampLoopRegion({ start: 4, end: 7 }, { in: 0, out: 5 }),
    ).toEqual({ start: 4, end: 5 });
  });

  test("loop starting before trim is shifted to trim start", () => {
    expect(
      clampLoopRegion({ start: -1, end: 1 }, { in: 0, out: 5 }),
    ).toEqual({ start: 0, end: 1 });
  });

  test("returns null when loop completely outside trim", () => {
    expect(
      clampLoopRegion({ start: 10, end: 12 }, { in: 0, out: 5 }),
    ).toBeNull();
  });

  test("returns null when start equals end after clamping", () => {
    expect(
      clampLoopRegion({ start: 5, end: 6 }, { in: 0, out: 5 }),
    ).toBeNull();
  });
});

describe("shouldRescheduleOnTick", () => {
  test("triggers when video time has crossed loop end", () => {
    expect(
      shouldRescheduleOnTick({
        videoTime: 2.05,
        loop: { start: 1, end: 2 },
      }),
    ).toBe(true);
  });

  test("does not trigger when still inside loop", () => {
    expect(
      shouldRescheduleOnTick({
        videoTime: 1.5,
        loop: { start: 1, end: 2 },
      }),
    ).toBe(false);
  });

  test("does not trigger when no loop is set", () => {
    expect(shouldRescheduleOnTick({ videoTime: 99, loop: null })).toBe(false);
  });

  test("triggers immediately when video time is before loop start (user scrubbed back)", () => {
    expect(
      shouldRescheduleOnTick({
        videoTime: 0.5,
        loop: { start: 1, end: 2 },
      }),
    ).toBe(true);
  });
});
