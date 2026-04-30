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
    expect(clipRangeS(clip)).toEqual({ anchorS: 0, startS: 0, endS: 10 });
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
    expect(clipRangeS(clip).anchorS).toBeCloseTo(-0.2, 6);
    expect(clipRangeS(clip).startS).toBeCloseTo(-0.2, 6);
    expect(clipRangeS(clip).endS).toBeCloseTo(9.8, 6);
  });

  // Trim is the in-point / out-point of a true cut: the visible
  // [startS, endS] range narrows, but anchorS — where the cam's
  // source-time 0 lives on the master timeline — must NOT move.
  // Otherwise the live preview's <video> currentTime computation
  // (VideoElementPool) plays from source frame 0 instead of frame trimInS.
  it("trimInS narrows startS but anchorS stays put", () => {
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
      trimInS: 2,
    };
    const r = clipRangeS(clip);
    expect(r.anchorS).toBeCloseTo(0, 6);
    expect(r.startS).toBeCloseTo(2, 6);
    expect(r.endS).toBeCloseTo(10, 6);
  });

  it("trimOutS narrows endS but anchorS stays put", () => {
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
      trimOutS: 7,
    };
    const r = clipRangeS(clip);
    expect(r.anchorS).toBeCloseTo(0, 6);
    expect(r.startS).toBeCloseTo(0, 6);
    expect(r.endS).toBeCloseTo(7, 6);
  });

  it("trim combines with sync override — anchor still derived from sync only", () => {
    const clip: VideoClip = {
      kind: "video",
      id: "cam-1",
      filename: "v.mp4",
      color: "#fff",
      sourceDurationS: 10,
      syncOffsetMs: 500,
      syncOverrideMs: 0,
      startOffsetS: 0,
      driftRatio: 1,
      candidates: [],
      selectedCandidateIdx: 0,
      trimInS: 1.5,
      trimOutS: 8,
    };
    const r = clipRangeS(clip);
    // -(500)/1000 = -0.5 → anchorS = -0.5; visible = [-0.5+1.5, -0.5+8] = [1.0, 7.5]
    expect(r.anchorS).toBeCloseTo(-0.5, 6);
    expect(r.startS).toBeCloseTo(1.0, 6);
    expect(r.endS).toBeCloseTo(7.5, 6);
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
    expect(clipRangeS(clip)).toEqual({ anchorS: 12.5, startS: 12.5, endS: 17.5 });
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
    expect(clipRangeS(clip)).toEqual({ anchorS: 0, startS: 0, endS: 3 });
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
