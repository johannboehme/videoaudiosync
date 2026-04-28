import { describe, expect, it } from "vitest";
import { buildQuantizePreview } from "./quantize";
import type { VideoClip } from "./types";
import type { Cut } from "../storage/jobs-db";

const BPM = 120;
const PHASE = 0;

const clip: VideoClip = {
  id: "cam-1",
  filename: "v.mp4",
  color: "#fff",
  sourceDurationS: 30,
  syncOffsetMs: 0,
  syncOverrideMs: 0,
  startOffsetS: 0.21, // off-grid (beat = 0.5)
  candidates: [],
  selectedCandidateIdx: 0,
};

describe("buildQuantizePreview — empty modes are no-ops", () => {
  it("returns empty preview when mode is OFF", () => {
    const preview = buildQuantizePreview(
      { cuts: [], clips: [clip], trim: { in: 0, out: 30 } },
      "off",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.cuts).toEqual([]);
    expect(preview.clipStartOffsets).toEqual([]);
    expect(preview.trim).toBeNull();
  });

  it("returns empty preview when mode is MATCH (no time-grid)", () => {
    const preview = buildQuantizePreview(
      { cuts: [], clips: [clip], trim: { in: 0, out: 30 } },
      "match",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.cuts).toEqual([]);
    expect(preview.clipStartOffsets).toEqual([]);
    expect(preview.trim).toBeNull();
  });

  it("returns empty preview when bpm is null (grid is undefined)", () => {
    const preview = buildQuantizePreview(
      { cuts: [{ atTimeS: 0.31, camId: "cam-1" }], clips: [], trim: { in: 0, out: 30 } },
      "1/4",
      { bpm: null, beatPhase: 0 },
    );
    expect(preview.cuts).toEqual([]);
  });
});

describe("buildQuantizePreview — quantizes cuts to the grid", () => {
  it("only emits from/to pairs for off-grid markers (on-grid skipped)", () => {
    const cuts: Cut[] = [
      { atTimeS: 0.5, camId: "cam-1" }, // on-grid (= beat 1 at 120 BPM)
      { atTimeS: 0.61, camId: "cam-1" }, // off-grid → snap to 0.5
      { atTimeS: 1.0, camId: "cam-1" }, // on-grid (beat 2)
      { atTimeS: 1.27, camId: "cam-1" }, // off-grid → snap to 1.5 (1.27 closer to 1.5? 1.0->0.27, 1.5->0.23)
    ];
    const preview = buildQuantizePreview(
      { cuts, clips: [], trim: { in: 0, out: 30 } },
      "1/4",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.cuts.length).toBe(2);
    const fromTimes = preview.cuts.map((c) => c.from).sort((a, b) => a - b);
    expect(fromTimes).toEqual([0.61, 1.27]);
  });
});

describe("buildQuantizePreview — quantizes clip startOffsetS", () => {
  it("snaps the clip's master-timeline start position", () => {
    // clip.startOffsetS=0.21 with sync=0 → masterStartS=0.21 → snap to 0.0
    // Expected newStartOffsetS so that masterStartS = 0 → newStartOffset = 0
    const preview = buildQuantizePreview(
      { cuts: [], clips: [clip], trim: { in: 0, out: 30 } },
      "1/4",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.clipStartOffsets.length).toBe(1);
    expect(preview.clipStartOffsets[0].camId).toBe("cam-1");
    expect(preview.clipStartOffsets[0].from).toBeCloseTo(0.21, 6);
    expect(preview.clipStartOffsets[0].to).toBeCloseTo(0, 6);
  });

  it("on-grid clips are skipped", () => {
    const onGrid: VideoClip = { ...clip, startOffsetS: 0.5 }; // = beat at BPM=120
    const preview = buildQuantizePreview(
      { cuts: [], clips: [onGrid], trim: { in: 0, out: 30 } },
      "1/4",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.clipStartOffsets).toEqual([]);
  });
});

describe("buildQuantizePreview — quantizes trim region", () => {
  it("snaps trim.in and trim.out independently when off-grid", () => {
    const preview = buildQuantizePreview(
      { cuts: [], clips: [], trim: { in: 0.21, out: 4.27 } },
      "1/4",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.trim).not.toBeNull();
    expect(preview.trim!.from).toEqual({ in: 0.21, out: 4.27 });
    expect(preview.trim!.to.in).toBeCloseTo(0, 6);
    // 4.27 is closer to 4.0 than 4.5 (0.27 vs 0.23) — actually 4.5 is closer.
    expect(preview.trim!.to.out).toBeCloseTo(4.5, 6);
  });

  it("on-grid trim is omitted from the preview", () => {
    const preview = buildQuantizePreview(
      { cuts: [], clips: [], trim: { in: 0, out: 4 } },
      "1/4",
      { bpm: BPM, beatPhase: PHASE },
    );
    expect(preview.trim).toBeNull();
  });
});
