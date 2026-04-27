import { describe, expect, it } from "vitest";
import {
  applyPreset,
  estimateFileSizeBytes,
  qualityToBitrates,
  resolveResolution,
  type SourceProbe,
} from "./exportPresets";

const SOURCE_LANDSCAPE_1080: SourceProbe = { w: 1920, h: 1080, durationS: 60 };
const SOURCE_PORTRAIT_1080: SourceProbe = { w: 1080, h: 1920, durationS: 60 };
const SOURCE_SQUARE_1080: SourceProbe = { w: 1080, h: 1080, durationS: 60 };
const SOURCE_4K: SourceProbe = { w: 3840, h: 2160, durationS: 60 };
const SOURCE_720p: SourceProbe = { w: 1280, h: 720, durationS: 60 };

describe("qualityToBitrates", () => {
  it("returns increasing video and audio bitrates for each step", () => {
    const tiny = qualityToBitrates("tiny", { w: 1920, h: 1080 });
    const low = qualityToBitrates("low", { w: 1920, h: 1080 });
    const good = qualityToBitrates("good", { w: 1920, h: 1080 });
    const high = qualityToBitrates("high", { w: 1920, h: 1080 });
    const pristine = qualityToBitrates("pristine", { w: 1920, h: 1080 });

    expect(tiny.videoKbps).toBeLessThan(low.videoKbps);
    expect(low.videoKbps).toBeLessThan(good.videoKbps);
    expect(good.videoKbps).toBeLessThan(high.videoKbps);
    expect(high.videoKbps).toBeLessThan(pristine.videoKbps);

    expect(tiny.audioKbps).toBeLessThan(pristine.audioKbps);
  });

  it("scales video bitrate with pixel area", () => {
    const at720p = qualityToBitrates("good", { w: 1280, h: 720 });
    const at1080p = qualityToBitrates("good", { w: 1920, h: 1080 });
    const at4k = qualityToBitrates("good", { w: 3840, h: 2160 });

    expect(at720p.videoKbps).toBeLessThan(at1080p.videoKbps);
    expect(at1080p.videoKbps).toBeLessThan(at4k.videoKbps);
    // 4K has 4× the pixels of 1080p → bitrate around 4× higher.
    expect(at4k.videoKbps / at1080p.videoKbps).toBeCloseTo(4, 0);
  });

  it("does not scale audio bitrate with resolution", () => {
    const at720p = qualityToBitrates("good", { w: 1280, h: 720 });
    const at4k = qualityToBitrates("good", { w: 3840, h: 2160 });
    expect(at720p.audioKbps).toBe(at4k.audioKbps);
  });
});

describe("resolveResolution", () => {
  it("source-pass-through returns source dimensions", () => {
    expect(resolveResolution("source", SOURCE_LANDSCAPE_1080)).toEqual({
      w: 1920,
      h: 1080,
    });
    expect(resolveResolution("source", SOURCE_PORTRAIT_1080)).toEqual({
      w: 1080,
      h: 1920,
    });
  });

  it("explicit dimensions are returned as-is", () => {
    expect(resolveResolution({ w: 640, h: 480 }, SOURCE_LANDSCAPE_1080)).toEqual({
      w: 640,
      h: 480,
    });
  });
});

describe("applyPreset — aspect-aware", () => {
  it("WEB caps long-side at 1920 for 4K, preserves aspect", () => {
    const spec = applyPreset("web", SOURCE_4K);
    expect(spec.resolution).toEqual({ w: 1920, h: 1080 });
    expect(spec.video_codec).toBe("h264");
  });

  it("WEB passes 1080p source through unchanged", () => {
    const spec = applyPreset("web", SOURCE_LANDSCAPE_1080);
    expect(spec.resolution).toEqual({ w: 1920, h: 1080 });
  });

  it("WEB caps a 4K portrait source on its long side (height)", () => {
    const spec = applyPreset("web", { w: 2160, h: 3840, durationS: 60 });
    expect(spec.resolution).toEqual({ w: 1080, h: 1920 });
  });

  it("ARCHIVE keeps source resolution at 4K, switches to H.265", () => {
    const spec = applyPreset("archive", SOURCE_4K);
    expect(spec.resolution).toEqual({ w: 3840, h: 2160 });
    expect(spec.video_codec).toBe("h265");
  });

  it("MOBILE caps long-side at 1080 for landscape source", () => {
    const spec = applyPreset("mobile", SOURCE_LANDSCAPE_1080);
    // 1920×1080 → already at the cap (long-side 1080 ≠ 1920 here — long-side is 1920).
    // Actually cap is on the long side at 1920 for mobile? Let's verify the contract.
    // For "mobile" in our scheme: long-side capped at 1920 → landscape stays 1920×1080.
    expect(spec.resolution).toEqual({ w: 1920, h: 1080 });
  });

  it("MOBILE preserves aspect for portrait source (the bug we are fixing)", () => {
    const spec = applyPreset("mobile", SOURCE_PORTRAIT_1080);
    // The old preset hardcoded 1280×720 → wrong for portrait. New preset
    // keeps the source's aspect with long-side capped at 1920.
    expect(spec.resolution).toEqual({ w: 1080, h: 1920 });
  });

  it("MOBILE keeps a square source square", () => {
    const spec = applyPreset("mobile", SOURCE_SQUARE_1080);
    expect(spec.resolution).toEqual({ w: 1080, h: 1080 });
  });

  it("MOBILE caps a 4K landscape source on its long side", () => {
    const spec = applyPreset("mobile", SOURCE_4K);
    // 3840×2160 → cap long-side at 1920 → 1920×1080.
    expect(spec.resolution).toEqual({ w: 1920, h: 1080 });
  });

  it("MOBILE keeps a 720p source unchanged (under cap)", () => {
    const spec = applyPreset("mobile", SOURCE_720p);
    expect(spec.resolution).toEqual({ w: 1280, h: 720 });
  });

  it("CUSTOM does not override resolution / codec — caller keeps current", () => {
    const spec = applyPreset("custom", SOURCE_LANDSCAPE_1080);
    expect(spec.preset).toBe("custom");
    // Custom preset only flips the discriminator; everything else is up to
    // the user's controls.
    expect(spec.resolution).toBeUndefined();
  });
});

describe("estimateFileSizeBytes", () => {
  it("computes bytes ≈ (videoKbps + audioKbps) × duration / 8", () => {
    const bytes = estimateFileSizeBytes({
      videoKbps: 3500,
      audioKbps: 128,
      durationS: 60,
    });
    // (3500 + 128) kbps × 60 s / 8 ≈ 27_210 KB ≈ 27.2 MB
    expect(bytes).toBeGreaterThan(26_000_000);
    expect(bytes).toBeLessThan(28_500_000);
  });

  it("scales linearly with duration", () => {
    const a = estimateFileSizeBytes({ videoKbps: 3000, audioKbps: 128, durationS: 30 });
    const b = estimateFileSizeBytes({ videoKbps: 3000, audioKbps: 128, durationS: 60 });
    expect(b / a).toBeCloseTo(2, 1);
  });

  it("returns 0 for zero duration or non-positive bitrate", () => {
    expect(estimateFileSizeBytes({ videoKbps: 3000, audioKbps: 128, durationS: 0 })).toBe(0);
    expect(estimateFileSizeBytes({ videoKbps: 0, audioKbps: 0, durationS: 60 })).toBe(0);
  });
});
