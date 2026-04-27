import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";
import { useEditorStore } from "../store";
import { SyncTuner } from "./SyncTuner";

const meta = {
  id: "j1",
  fps: 30,
  duration: 60,
  width: 1920,
  height: 1080,
  algoOffsetMs: 250,
  driftRatio: 1.0,
};

describe("<SyncTuner />", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore.getState().loadJob(meta, {
      lastSyncOverrideMs: -120,
      clips: [
        {
          id: "cam-1",
          filename: "cam-1.mp4",
          color: "#3b6dff",
          sourceDurationS: 60,
          syncOffsetMs: 250,
        },
      ],
    });
  });

  test("nudge buttons update the store", async () => {
    render(<SyncTuner lastSyncOverrideMs={-120} />);
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(-120);
    const plus10 = screen.getByRole("button", { name: "+10" });
    await userEvent.click(plus10);
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(-110);
  });

  test("A/B segmented control toggles abBypass", async () => {
    render(<SyncTuner lastSyncOverrideMs={null} />);
    const algo = screen.getByRole("tab", { name: /A.*ALGO/i });
    await userEvent.click(algo);
    expect(useEditorStore.getState().offset.abBypass).toBe(true);
  });

  test("RESET TO ALGO sets userOverrideMs to 0", async () => {
    render(<SyncTuner lastSyncOverrideMs={null} />);
    const reset = screen.getByRole("button", { name: /RESET TO ALGO/i });
    await userEvent.click(reset);
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(0);
  });

  test("USE LAST is shown when lastSyncOverrideMs differs from current", async () => {
    useEditorStore.getState().setOffset(0);
    render(<SyncTuner lastSyncOverrideMs={-120} />);
    const useLast = screen.getByRole("button", { name: /USE LAST/i });
    await userEvent.click(useLast);
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(-120);
  });

  test("USE LAST is hidden when lastSyncOverrideMs equals current", () => {
    render(<SyncTuner lastSyncOverrideMs={-120} />);
    expect(screen.queryByRole("button", { name: /USE LAST/i })).toBeNull();
  });

  test("loop preset buttons set a loop region around the playhead", async () => {
    useEditorStore.getState().setCurrentTime(10);
    useEditorStore.getState().setTrim({ in: 0, out: 60 });
    render(<SyncTuner lastSyncOverrideMs={null} />);
    const oneSec = screen.getByRole("button", { name: /^1s$/ });
    await userEvent.click(oneSec);
    const loop = useEditorStore.getState().playback.loop;
    expect(loop).not.toBeNull();
    expect(loop!.end - loop!.start).toBeCloseTo(1, 5);
  });
});
