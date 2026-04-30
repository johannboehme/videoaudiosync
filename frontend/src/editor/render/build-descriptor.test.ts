import { describe, expect, it } from "vitest";
import {
  buildPreviewFrameDescriptor,
  computeFitRect,
  type EditorStoreSnapshot,
} from "./build-descriptor";
import type { Clip, ImageClip, VideoClip } from "../types";
import type { Cut } from "../../storage/jobs-db";
import type { PunchFx } from "../fx/types";

function video(id: string, displayW?: number, displayH?: number, more: Partial<VideoClip> = {}): VideoClip {
  return {
    kind: "video",
    id,
    filename: `${id}.mp4`,
    color: "#fff",
    sourceDurationS: 60,
    syncOffsetMs: 0,
    syncOverrideMs: 0,
    startOffsetS: 0,
    driftRatio: 1,
    candidates: [],
    selectedCandidateIdx: 0,
    displayW,
    displayH,
    ...more,
  };
}

function image(id: string, displayW?: number, displayH?: number, more: Partial<ImageClip> = {}): ImageClip {
  return {
    kind: "image",
    id,
    filename: `${id}.png`,
    color: "#fff",
    durationS: 5,
    startOffsetS: 0,
    displayW,
    displayH,
    ...more,
  };
}

function snap(over: Partial<EditorStoreSnapshot> = {}): EditorStoreSnapshot {
  return {
    clips: [],
    cuts: [],
    fx: [],
    exportSpec: { preset: "web" },
    ...over,
  };
}

// ----------------------------------------------------------------------

describe("buildPreviewFrameDescriptor — output dims", () => {
  it("returns null output and no layers when no clips have displayDims", () => {
    const d = buildPreviewFrameDescriptor(snap(), 0);
    expect(d.output).toBeNull();
    expect(d.layers).toEqual([]);
  });

  it("uses bbox(maxW, maxH) over clips that have displayDims", () => {
    const clips: Clip[] = [video("a", 1920, 1080), video("b", 720, 1280)];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    expect(d.output).toEqual({ w: 1920, h: 1280 });
  });

  it("explicit exportSpec.resolution overrides bbox", () => {
    const clips: Clip[] = [video("a", 1920, 1080)];
    const d = buildPreviewFrameDescriptor(
      snap({ clips, exportSpec: { preset: "custom", resolution: { w: 1280, h: 720 } } }),
      0,
    );
    expect(d.output).toEqual({ w: 1280, h: 720 });
  });

  it("snaps output dims to integer pixels", () => {
    const clips: Clip[] = [video("a", 1280, 720)];
    const d = buildPreviewFrameDescriptor(
      snap({ clips, exportSpec: { preset: "custom", resolution: { w: 1280.4, h: 719.6 } } }),
      0,
    );
    expect(d.output).toEqual({ w: 1280, h: 720 });
  });
});

// ----------------------------------------------------------------------

describe("buildPreviewFrameDescriptor — layers", () => {
  it("emits no layers when output is null even if clips exist", () => {
    const d = buildPreviewFrameDescriptor(snap({ clips: [video("a")] }), 0);
    expect(d.output).toBeNull();
    expect(d.layers).toEqual([]);
  });

  it("emits one video layer for the active cam at full output rect", () => {
    const clips: Clip[] = [video("a", 1920, 1080)];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    expect(d.layers).toHaveLength(1);
    const l = d.layers[0];
    expect(l.layerId).toBe("a");
    expect(l.weight).toBe(1);
    expect(l.fitRect).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
    expect(l.rotationDeg).toBe(0);
    expect(l.flipX).toBe(false);
    expect(l.flipY).toBe(false);
    expect(l.displayW).toBe(1920);
    expect(l.displayH).toBe(1080);
  });

  it("video layer carries source-time and duration", () => {
    const clips: Clip[] = [video("a", 1920, 1080, { sourceDurationS: 30 })];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 1.5);
    const l = d.layers[0];
    expect(l.source).toEqual({
      kind: "video",
      clipId: "a",
      sourceTimeS: 1.5,
      sourceDurS: 30,
    });
  });

  it("source-time includes syncOffset / override / drift", () => {
    // syncOffsetMs=200 → masterStartS = -0.2 → source(t=0.5) = (0.5 - (-0.2)) * 1.5 = 1.05
    const clips: Clip[] = [
      video("a", 1920, 1080, { syncOffsetMs: 200, driftRatio: 1.5 }),
    ];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0.5);
    const src = d.layers[0].source;
    if (src.kind !== "video") throw new Error("expected video source");
    expect(src.sourceTimeS).toBeCloseTo(1.05, 6);
  });

  it("emits image layer for an image clip", () => {
    const clips: Clip[] = [image("img1", 800, 600)];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    expect(d.layers[0].source).toEqual({ kind: "image", clipId: "img1" });
  });

  it("respects cuts: switches active cam at cut time", () => {
    const clips: Clip[] = [video("a", 1920, 1080), video("b", 1920, 1080)];
    const cuts: Cut[] = [{ atTimeS: 1.0, camId: "b" }];
    const before = buildPreviewFrameDescriptor(snap({ clips, cuts }), 0.5);
    const after = buildPreviewFrameDescriptor(snap({ clips, cuts }), 1.5);
    expect(before.layers[0].layerId).toBe("a");
    expect(after.layers[0].layerId).toBe("b");
  });

  it("emits no layers (only test-pattern fallback) when no cam has material at t", () => {
    // Clip with finite range; t outside its range → activeCamId is null
    const clips: Clip[] = [
      video("a", 1920, 1080, { sourceDurationS: 1, trimInS: 0, trimOutS: 1 }),
    ];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 5);
    expect(d.layers).toEqual([]);
  });

  it("user rotation 90 swaps display dims and propagates rotationDeg", () => {
    const clips: Clip[] = [
      video("a", 1920, 1080, { rotation: 90, flipX: true }),
    ];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    const l = d.layers[0];
    expect(l.rotationDeg).toBe(90);
    expect(l.flipX).toBe(true);
    expect(l.flipY).toBe(false);
    expect(l.displayW).toBe(1080);
    expect(l.displayH).toBe(1920);
  });

  it("rotation 180 leaves display dims, sets rotationDeg=180", () => {
    const clips: Clip[] = [video("a", 1920, 1080, { rotation: 180 })];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    const l = d.layers[0];
    expect(l.rotationDeg).toBe(180);
    expect(l.displayW).toBe(1920);
    expect(l.displayH).toBe(1080);
  });

  it("normalises out-of-range rotation values", () => {
    const clips: Clip[] = [video("a", 1920, 1080, { rotation: 450 })]; // 450 → 90
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    expect(d.layers[0].rotationDeg).toBe(90);
  });

  it("fitRect letterboxes when active cam is wider than output bbox", () => {
    // bbox = max(1920, 720), max(1080, 1280) = 1920 × 1280
    const clips: Clip[] = [video("a", 1920, 1080), video("b", 720, 1280)];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    expect(d.output).toEqual({ w: 1920, h: 1280 });
    const fr = d.layers[0].fitRect;
    expect(fr.x).toBe(0);
    expect(fr.w).toBe(1920);
    expect(fr.h).toBeCloseTo(1080, 4);
    expect(fr.y).toBeCloseTo((1280 - 1080) / 2, 4);
  });

  it("fitRect pillarboxes when active cam is taller than output bbox", () => {
    const clips: Clip[] = [video("a", 1920, 1080), video("b", 720, 1280)];
    const cuts: Cut[] = [{ atTimeS: 0, camId: "b" }];
    const d = buildPreviewFrameDescriptor(snap({ clips, cuts }), 0.5);
    const fr = d.layers[0].fitRect;
    expect(fr.y).toBe(0);
    expect(fr.h).toBe(1280);
    expect(fr.w).toBeCloseTo(720, 4);
    expect(fr.x).toBeCloseTo((1920 - 720) / 2, 4);
  });
});

// ----------------------------------------------------------------------

describe("buildPreviewFrameDescriptor — fx", () => {
  it("includes only active fx in stable order", () => {
    const fx: PunchFx[] = [
      { id: "f1", kind: "vignette", inS: 0, outS: 1.0 },
      { id: "f2", kind: "vignette", inS: 0.5, outS: 1.5, params: { intensity: 0.5 } },
      { id: "f3", kind: "vignette", inS: 2, outS: 3 },
    ];
    const d = buildPreviewFrameDescriptor(snap({ fx }), 0.7);
    expect(d.fx.map((f) => f.id)).toEqual(["f1", "f2"]);
  });

  it("merges defaults into params when fx has none", () => {
    const fx: PunchFx[] = [{ id: "f1", kind: "vignette", inS: 0, outS: 1.0 }];
    const d = buildPreviewFrameDescriptor(snap({ fx }), 0.5);
    const params = d.fx[0].params;
    expect(params.intensity).toBeGreaterThan(0);
    expect(params.falloff).toBeGreaterThan(0);
  });

  it("explicit params override defaults but missing keys still default", () => {
    const fx: PunchFx[] = [
      { id: "f1", kind: "vignette", inS: 0, outS: 1.0, params: { intensity: 0.3 } },
    ];
    const d = buildPreviewFrameDescriptor(snap({ fx }), 0.5);
    expect(d.fx[0].params.intensity).toBe(0.3);
    expect(d.fx[0].params.falloff).toBeGreaterThan(0); // default applied
  });

  it("returns empty fx list when none active at t", () => {
    const fx: PunchFx[] = [{ id: "f1", kind: "vignette", inS: 0, outS: 0.5 }];
    const d = buildPreviewFrameDescriptor(snap({ fx }), 1.0);
    expect(d.fx).toEqual([]);
  });
});

// ----------------------------------------------------------------------

describe("buildPreviewFrameDescriptor — structural invariants", () => {
  it("descriptor is JSON-roundtrip-safe (no DOM refs, no functions)", () => {
    const clips: Clip[] = [video("a", 1920, 1080, { rotation: 90, flipX: true })];
    const fx: PunchFx[] = [{ id: "f", kind: "vignette", inS: 0, outS: 1 }];
    const d = buildPreviewFrameDescriptor(snap({ clips, fx }), 0.5);
    const round = JSON.parse(JSON.stringify(d));
    expect(round).toEqual(d);
  });

  it("layers from cuts are exclusive — V2 emits at most one layer", () => {
    const clips: Clip[] = [
      video("a", 1920, 1080),
      video("b", 1920, 1080),
      video("c", 1920, 1080),
    ];
    const d = buildPreviewFrameDescriptor(snap({ clips }), 0);
    expect(d.layers.length).toBeLessThanOrEqual(1);
  });

  it("fx from polyphonic FX list — multiple can overlap at the same time", () => {
    const fx: PunchFx[] = [
      { id: "f1", kind: "vignette", inS: 0, outS: 1 },
      { id: "f2", kind: "vignette", inS: 0, outS: 1 },
      { id: "f3", kind: "vignette", inS: 0, outS: 1 },
    ];
    const d = buildPreviewFrameDescriptor(snap({ fx }), 0.5);
    expect(d.fx).toHaveLength(3);
  });
});

// ----------------------------------------------------------------------

describe("computeFitRect", () => {
  it("fills full destination on AR match", () => {
    expect(computeFitRect(1920, 1080, 1280, 720)).toEqual({ x: 0, y: 0, w: 1280, h: 720 });
  });

  it("letterboxes when source is wider", () => {
    const r = computeFitRect(1920, 1080, 1920, 1280);
    expect(r.x).toBe(0);
    expect(r.w).toBe(1920);
    expect(r.h).toBeCloseTo(1080, 4);
    expect(r.y).toBeCloseTo(100, 4);
  });

  it("pillarboxes when source is taller", () => {
    const r = computeFitRect(720, 1280, 1920, 1280);
    expect(r.y).toBe(0);
    expect(r.h).toBe(1280);
    expect(r.w).toBeCloseTo(720, 4);
    expect(r.x).toBeCloseTo(600, 4);
  });

  it("returns zero rect for non-positive inputs", () => {
    expect(computeFitRect(0, 1080, 1920, 1280)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
    expect(computeFitRect(1920, 0, 1920, 1280)).toEqual({ x: 0, y: 0, w: 0, h: 0 });
  });
});
