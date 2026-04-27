import { describe, it, expect } from "vitest";
import { migrateV1ToV2, CAM_COLORS } from "./migrations";
import type { LocalJob } from "./jobs-db";

function v1Job(overrides: Partial<LocalJob> = {}): LocalJob {
  return {
    id: "job-abc",
    title: null,
    videoFilename: "video.mp4",
    audioFilename: "audio.wav",
    status: "synced",
    progress: { pct: 100, stage: "synced" },
    sync: { offsetMs: 250, driftRatio: 1.0001, confidence: 0.85 },
    durationS: 120,
    width: 1920,
    height: 1080,
    fps: 30,
    hasOutput: false,
    createdAt: 1700000000000,
    ...overrides,
  };
}

describe("migrateV1ToV2", () => {
  it("turns the single videoFilename into a one-element videos array", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.videos).toHaveLength(1);
    expect(migrated.videos![0].filename).toBe("video.mp4");
  });

  it("assigns a stable cam id (cam-1) to the first video", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.videos![0].id).toBe("cam-1");
  });

  it("assigns the first palette color to the migrated cam", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.videos![0].color).toBe(CAM_COLORS[0]);
  });

  it("copies the sync result to videos[0].sync", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.videos![0].sync).toEqual({
      offsetMs: 250,
      driftRatio: 1.0001,
      confidence: 0.85,
    });
  });

  it("copies durationS / width / height / fps to videos[0]", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.videos![0].durationS).toBe(120);
    expect(migrated.videos![0].width).toBe(1920);
    expect(migrated.videos![0].height).toBe(1080);
    expect(migrated.videos![0].fps).toBe(30);
  });

  it("starts cuts as an empty array (single-cam jobs need no cuts)", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.cuts).toEqual([]);
  });

  it("stamps schemaVersion: 2", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.schemaVersion).toBe(2);
  });

  it("keeps the legacy fields intact (no data loss for unmigrated consumers)", () => {
    const migrated = migrateV1ToV2(v1Job());
    expect(migrated.videoFilename).toBe("video.mp4");
    expect(migrated.audioFilename).toBe("audio.wav");
    expect(migrated.sync).toEqual({
      offsetMs: 250,
      driftRatio: 1.0001,
      confidence: 0.85,
    });
  });

  it("is idempotent — already-V2 jobs pass through unchanged", () => {
    const once = migrateV1ToV2(v1Job());
    const twice = migrateV1ToV2(once);
    expect(twice).toBe(once);
  });

  it("handles a job without sync result (status: queued)", () => {
    const migrated = migrateV1ToV2(
      v1Job({ status: "queued", sync: undefined, durationS: undefined }),
    );
    expect(migrated.videos![0].sync).toBeUndefined();
    expect(migrated.videos![0].durationS).toBeUndefined();
  });
});
