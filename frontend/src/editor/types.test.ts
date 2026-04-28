import { describe, it, expect } from "vitest";
import {
  clipRangeS,
  isImageClip,
  isVideoClip,
  type ImageClip,
  type VideoClip,
} from "./types";

describe("clipRangeS — Video", () => {
  it("computes startS = -syncOffset/1000 for a perfectly aligned cam", () => {
    const clip: VideoClip = {
      kind: "video",
      id: "cam-1",
      filename: "v.mp4",
      color: "#fff",
      sourceDurationS: 10,
      syncOffsetMs: 0,
      syncOverrideMs: 0,
      startOffsetS: 0,
      driftRatio: 1,
      candidates: [],
      selectedCandidateIdx: 0,
    };
    expect(clipRangeS(clip)).toEqual({ startS: 0, endS: 10 });
  });

  it("applies sync override + start offset", () => {
    const clip: VideoClip = {
      kind: "video",
      id: "cam-1",
      filename: "v.mp4",
      color: "#fff",
      sourceDurationS: 10,
      syncOffsetMs: 500,
      syncOverrideMs: -100,
      startOffsetS: 0.2,
      driftRatio: 1,
      candidates: [],
      selectedCandidateIdx: 0,
    };
    // -(500 - 100)/1000 + 0.2 = -0.4 + 0.2 = -0.2
    expect(clipRangeS(clip).startS).toBeCloseTo(-0.2, 6);
    expect(clipRangeS(clip).endS).toBeCloseTo(9.8, 6);
  });
});

describe("clipRangeS — Image", () => {
  it("uses startOffsetS + durationS verbatim", () => {
    const clip: ImageClip = {
      kind: "image",
      id: "cam-2",
      filename: "still.png",
      color: "#fff",
      durationS: 5,
      startOffsetS: 12.5,
    };
    expect(clipRangeS(clip)).toEqual({ startS: 12.5, endS: 17.5 });
  });

  it("startS = 0 when the image sits at the timeline origin", () => {
    const clip: ImageClip = {
      kind: "image",
      id: "cam-2",
      filename: "still.png",
      color: "#fff",
      durationS: 3,
      startOffsetS: 0,
    };
    expect(clipRangeS(clip)).toEqual({ startS: 0, endS: 3 });
  });
});

describe("type guards", () => {
  const video: VideoClip = {
    kind: "video",
    id: "cam-1",
    filename: "v.mp4",
    color: "#fff",
    sourceDurationS: 10,
    syncOffsetMs: 0,
    syncOverrideMs: 0,
    startOffsetS: 0,
    driftRatio: 1,
    candidates: [],
    selectedCandidateIdx: 0,
  };
  const image: ImageClip = {
    kind: "image",
    id: "cam-2",
    filename: "still.png",
    color: "#fff",
    durationS: 5,
    startOffsetS: 0,
  };

  it("isVideoClip identifies video clips and rejects images", () => {
    expect(isVideoClip(video)).toBe(true);
    expect(isVideoClip(image)).toBe(false);
  });

  it("isImageClip identifies image clips and rejects videos", () => {
    expect(isImageClip(video)).toBe(false);
    expect(isImageClip(image)).toBe(true);
  });

  it("treats a VideoClip with kind undefined (legacy) as video", () => {
    const legacy = { ...video, kind: undefined } as VideoClip;
    expect(isVideoClip(legacy)).toBe(true);
    expect(isImageClip(legacy)).toBe(false);
  });
});
