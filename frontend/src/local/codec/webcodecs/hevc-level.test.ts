import { describe, expect, it } from "vitest";
import { hevcCodecForResolution, pickHevcLevel } from "./hevc-level";

describe("pickHevcLevel — picks the lowest level that covers the resolution + fps", () => {
  it("720p @ 30 fits Level 3.1 (marker 93)", () => {
    expect(pickHevcLevel(1280, 720, 30)).toBe(93);
  });

  it("1080p @ 30 fits Level 4 (marker 120)", () => {
    expect(pickHevcLevel(1920, 1080, 30)).toBe(120);
  });

  it("1080p @ 60 needs Level 4.1 (marker 123)", () => {
    expect(pickHevcLevel(1920, 1080, 60)).toBe(123);
  });

  it("4K @ 30 fits Level 5 (marker 150)", () => {
    expect(pickHevcLevel(3840, 2160, 30)).toBe(150);
  });

  it("portrait 1080×1920 @ 30 picks the same level as landscape 1920×1080", () => {
    expect(pickHevcLevel(1080, 1920, 30)).toBe(120);
  });
});

describe("hevcCodecForResolution — emits a parsable hev1 codec string", () => {
  it("matches the documented Main-profile, Main-tier shape", () => {
    expect(hevcCodecForResolution(1920, 1080, 30)).toBe("hev1.1.6.L120.B0");
    expect(hevcCodecForResolution(1280, 720, 30)).toBe("hev1.1.6.L93.B0");
    expect(hevcCodecForResolution(3840, 2160, 30)).toBe("hev1.1.6.L150.B0");
  });
});
