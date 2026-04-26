import { beforeEach, describe, expect, test } from "vitest";
import { useEditorStore } from "./store";

const baseJobMeta = {
  id: "j1",
  fps: 30,
  duration: 60,
  width: 1920,
  height: 1080,
  algoOffsetMs: 250,
  driftRatio: 1.0,
};

describe("useEditorStore", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  test("initial state has empty job and zero override", () => {
    const s = useEditorStore.getState();
    expect(s.jobMeta).toBeNull();
    expect(s.offset.userOverrideMs).toBe(0);
    expect(s.trim.in).toBe(0);
    expect(s.trim.out).toBe(0);
  });

  test("loadJob sets meta, default trim spans full duration", () => {
    useEditorStore.getState().loadJob(baseJobMeta, { lastSyncOverrideMs: -120 });
    const s = useEditorStore.getState();
    expect(s.jobMeta?.id).toBe("j1");
    expect(s.trim).toEqual({ in: 0, out: 60 });
    expect(s.offset.userOverrideMs).toBe(-120);
  });

  test("nudgeOffset accumulates with sub-ms precision rounding", () => {
    useEditorStore.getState().loadJob(baseJobMeta, { lastSyncOverrideMs: 0 });
    const { nudgeOffset } = useEditorStore.getState();
    nudgeOffset(10);
    nudgeOffset(1);
    nudgeOffset(-100);
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(-89);
  });

  test("setOffset replaces value", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setOffset(-42);
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(-42);
  });

  test("totalOffsetMs combines algo + override", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setOffset(-50);
    expect(useEditorStore.getState().totalOffsetMs()).toBe(200);
  });

  test("setTrimIn clamps to <= trim.out - epsilon", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setTrim({ in: 70, out: 60 });
    const trim = useEditorStore.getState().trim;
    expect(trim.in).toBeLessThan(trim.out);
  });

  test("setLoop clamps to trim region", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setTrim({ in: 5, out: 50 });
    useEditorStore.getState().setLoop({ start: 1, end: 60 });
    expect(useEditorStore.getState().playback.loop).toEqual({ start: 5, end: 50 });
  });

  test("setLoop with region fully outside trim becomes null", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setTrim({ in: 0, out: 10 });
    useEditorStore.getState().setLoop({ start: 20, end: 25 });
    expect(useEditorStore.getState().playback.loop).toBeNull();
  });

  test("addOverlay assigns and removeOverlay drops by index", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().addOverlay({
      type: "text",
      text: "hello",
      start: 1,
      end: 2,
    });
    expect(useEditorStore.getState().overlays.length).toBe(1);
    useEditorStore.getState().removeOverlay(0);
    expect(useEditorStore.getState().overlays.length).toBe(0);
  });

  test("setExportPreset only updates preset, keeps other fields", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setExport({ preset: "archive", video_bitrate_kbps: 9000 });
    useEditorStore.getState().setExport({ preset: "mobile" });
    const ex = useEditorStore.getState().exportSpec;
    expect(ex.preset).toBe("mobile");
    expect(ex.video_bitrate_kbps).toBe(9000);
  });

  test("buildEditSpec reflects current state", () => {
    useEditorStore.getState().loadJob(baseJobMeta);
    useEditorStore.getState().setTrim({ in: 1, out: 5 });
    useEditorStore.getState().setOffset(-30);
    useEditorStore.getState().setExport({ preset: "web" });
    const spec = useEditorStore.getState().buildEditSpec();
    expect(spec.version).toBe(1);
    expect(spec.segments).toEqual([{ in: 1, out: 5 }]);
    expect(spec.sync_override_ms).toBe(-30);
    expect(spec.export?.preset).toBe("web");
  });
});
