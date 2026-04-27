import { describe, it, expect } from "vitest";
import { pickAvcLevel, avcCodecForResolution } from "./avc-level";

describe("pickAvcLevel", () => {
  it("picks 3.1 (0x1f) for 1280×720 @ 30fps (the canonical Constrained-Baseline target)", () => {
    expect(pickAvcLevel(1280, 720, 30)).toBe(0x1f);
  });

  it("picks 4.0+ for 1080p @ 30fps", () => {
    const lvl = pickAvcLevel(1920, 1080, 30);
    // 1920×1080 = 8160 MBs → fits 4.0 (8192) but at 30fps → 244800 MBPS,
    // 4.0 caps at 245760, so 4.0 is acceptable.
    expect(lvl).toBeGreaterThanOrEqual(0x28);
  });

  it("picks at least 5.0 for the user's 1392×1872 fail case", () => {
    // The bug report: this resolution previously failed against the
    // hardcoded Level 3.1 default. 1392×1872 = 87×117 = 10179 MBs,
    // needs MaxFS ≥ 10179 → Level 5.0 (22080) is the first that fits.
    const lvl = pickAvcLevel(1392, 1872, 30);
    expect(lvl).toBeGreaterThanOrEqual(0x32);
  });

  it("picks 5.1+ for 4K @ 30fps", () => {
    const lvl = pickAvcLevel(3840, 2160, 30);
    expect(lvl).toBeGreaterThanOrEqual(0x33);
  });

  it("never returns below 1.0 even for tiny inputs", () => {
    const lvl = pickAvcLevel(64, 48, 1);
    expect(lvl).toBeGreaterThanOrEqual(0x0a);
  });

  it("framerate matters: 1080p @ 60fps needs at least 4.2", () => {
    // 8160 MBs × 60 = 489600 MBPS → 4.2 (522240) is first that fits.
    const lvl = pickAvcLevel(1920, 1080, 60);
    expect(lvl).toBeGreaterThanOrEqual(0x2a);
  });
});

describe("avcCodecForResolution", () => {
  it("emits the conventional Constrained-Baseline string format", () => {
    expect(avcCodecForResolution(1280, 720, 30)).toBe("avc1.42E01F");
    expect(avcCodecForResolution(1392, 1872, 30)).toMatch(/^avc1\.42E0(32|33|34|3C|3D|3E)$/);
  });
});
