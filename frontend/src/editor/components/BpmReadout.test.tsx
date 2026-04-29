import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BpmReadout } from "./BpmReadout";
import { useEditorStore } from "../store";

const baseMeta = {
  id: "j1",
  fps: 30,
  duration: 60,
  width: 1920,
  height: 1080,
  algoOffsetMs: 0,
  driftRatio: 1,
};

describe("BpmReadout", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  test("displays --- when no BPM has been detected", () => {
    useEditorStore.getState().loadJob(baseMeta);
    render(<BpmReadout />);
    expect(screen.getByTestId("bpm-value").textContent).toMatch(/^[—-]+$/);
  });

  test("displays the detected BPM value rounded to integer", () => {
    useEditorStore
      .getState()
      .loadJob({
        ...baseMeta,
        bpm: { value: 124.36, confidence: 0.85, phase: 0, manualOverride: false },
      });
    render(<BpmReadout />);
    expect(screen.getByTestId("bpm-value").textContent).toBe("124");
  });

  test("renders a manual-override marker when the user has overridden BPM", () => {
    useEditorStore
      .getState()
      .loadJob({
        ...baseMeta,
        bpm: { value: 130, confidence: 0.85, phase: 0, manualOverride: true },
      });
    render(<BpmReadout />);
    expect(screen.queryByTestId("bpm-manual-marker")).toBeTruthy();
  });

  test("clicking opens the editor and submitting via Enter persists a manual override", () => {
    useEditorStore
      .getState()
      .loadJob({
        ...baseMeta,
        bpm: { value: 124, confidence: 0.85, phase: 0, manualOverride: false },
      });
    render(<BpmReadout />);
    fireEvent.click(screen.getByTestId("bpm-value"));
    const input = screen.getByTestId("bpm-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "128" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const bpm = useEditorStore.getState().jobMeta?.bpm;
    expect(bpm?.value).toBe(128);
    expect(bpm?.manualOverride).toBe(true);
  });

  test("Escape during edit cancels without changing the store", () => {
    useEditorStore
      .getState()
      .loadJob({
        ...baseMeta,
        bpm: { value: 124, confidence: 0.85, phase: 0, manualOverride: false },
      });
    render(<BpmReadout />);
    fireEvent.click(screen.getByTestId("bpm-value"));
    const input = screen.getByTestId("bpm-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "999" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(useEditorStore.getState().jobMeta?.bpm?.value).toBe(124);
    expect(useEditorStore.getState().jobMeta?.bpm?.manualOverride).toBe(false);
  });

  test("time-signature LCD reads the persisted beatsPerBar from the store", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 124, confidence: 0.85, phase: 0, manualOverride: false },
      beatsPerBar: 3,
    });
    render(<BpmReadout />);
    expect(screen.getByTestId("time-sig-value").textContent).toBe("3/4");
  });

  test("time-signature LCD defaults to 4/4 when nothing is persisted", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 124, confidence: 0.85, phase: 0, manualOverride: false },
    });
    render(<BpmReadout />);
    expect(screen.getByTestId("time-sig-value").textContent).toBe("4/4");
  });

  test("clicking a time-sig chip updates beatsPerBar in the store", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 124, confidence: 0.85, phase: 0, manualOverride: false },
    });
    render(<BpmReadout />);
    fireEvent.click(screen.getByTestId("time-sig-readout"));
    fireEvent.click(screen.getByTestId("time-sig-chip-6-8"));
    expect(useEditorStore.getState().jobMeta?.beatsPerBar).toBe(6);
  });

  test("'reset' button restores the detected BPM and clears the manual flag", () => {
    useEditorStore
      .getState()
      .loadJob({
        ...baseMeta,
        bpm: { value: 124, confidence: 0.85, phase: 0, manualOverride: false },
      });
    useEditorStore.getState().setBpm({ value: 130, manualOverride: true });
    render(<BpmReadout />);
    fireEvent.click(screen.getByTestId("bpm-value"));
    fireEvent.click(screen.getByTestId("bpm-reset"));
    const bpm = useEditorStore.getState().jobMeta?.bpm;
    expect(bpm?.value).toBe(124);
    expect(bpm?.manualOverride).toBe(false);
  });
});
