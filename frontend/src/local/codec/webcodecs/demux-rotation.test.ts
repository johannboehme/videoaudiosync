import { describe, expect, it } from "vitest";
import { rotationDegFromMatrix } from "./demux";

const F = 65536; // 1.0 in 16.16 fixed point

describe("rotationDegFromMatrix — ISO transform matrix decoding", () => {
  it("identity matrix → 0°", () => {
    // [1,0,0; 0,1,0; 0,0,1]
    expect(
      rotationDegFromMatrix([F, 0, 0, 0, F, 0, 0, 0, 0x40_000_000]),
    ).toBe(0);
  });

  it("undefined / too-short matrix → 0°", () => {
    expect(rotationDegFromMatrix(undefined)).toBe(0);
    expect(rotationDegFromMatrix([F, 0, 0, 0])).toBe(0);
  });

  it("decodes 90° CCW (matches the phone-recorded portrait case)", () => {
    // The exact bytes ffprobe shows for our test file:
    //   [    0   65536    0; -65536    0    0; ... ]
    expect(
      rotationDegFromMatrix([0, F, 0, -F, 0, 0, 0, 0, 0x40_000_000]),
    ).toBe(90);
  });

  it("decodes 180° (upside-down)", () => {
    // [-1, 0, 0; 0, -1, 0; ...]
    expect(
      rotationDegFromMatrix([-F, 0, 0, 0, -F, 0, 0, 0, 0x40_000_000]),
    ).toBe(180);
  });

  it("decodes 270° (= -90°)", () => {
    // [0, -1, 0; 1, 0, 0; ...]
    expect(
      rotationDegFromMatrix([0, -F, 0, F, 0, 0, 0, 0, 0x40_000_000]),
    ).toBe(270);
  });

  it("snaps small-noise matrices to the nearest cardinal angle", () => {
    // 89.5° from a=cos(89.5°), b=sin(89.5°) — should snap to 90.
    const a = Math.round(Math.cos((89.5 * Math.PI) / 180) * F);
    const b = Math.round(Math.sin((89.5 * Math.PI) / 180) * F);
    expect(rotationDegFromMatrix([a, b, 0, -b, a, 0, 0, 0, 0x40_000_000])).toBe(90);
  });
});
