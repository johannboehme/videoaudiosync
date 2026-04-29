import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BarsHeader } from "./BarsHeader";
import { useEditorStore } from "../../store";

const baseMeta = {
  id: "j1",
  fps: 30,
  duration: 60,
  width: 1920,
  height: 1080,
  algoOffsetMs: 0,
  driftRatio: 1,
};

describe("BarsHeader", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
  });

  test("displays pickup 0 by default", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 120, confidence: 0.9, phase: 0, manualOverride: false },
    });
    render(<BarsHeader width={156} height={26} />);
    expect(screen.getByTestId("pickup-value").textContent).toBe("0");
  });

  test("reflects the persisted barOffsetBeats", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 120, confidence: 0.9, phase: 0, manualOverride: false },
      barOffsetBeats: 2,
    });
    render(<BarsHeader width={156} height={26} />);
    expect(screen.getByTestId("pickup-value").textContent).toBe("2");
  });

  test("clicking a pickup chip writes the new value to the store", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 120, confidence: 0.9, phase: 0, manualOverride: false },
    });
    render(<BarsHeader width={156} height={26} />);
    fireEvent.click(screen.getByTestId("pickup-readout"));
    fireEvent.click(screen.getByTestId("pickup-chip-2"));
    expect(useEditorStore.getState().jobMeta?.barOffsetBeats).toBe(2);
  });

  test("offers exactly `beatsPerBar` chips (one per possible pickup count)", () => {
    useEditorStore.getState().loadJob({
      ...baseMeta,
      bpm: { value: 120, confidence: 0.9, phase: 0, manualOverride: false },
      beatsPerBar: 3,
    });
    render(<BarsHeader width={156} height={26} />);
    fireEvent.click(screen.getByTestId("pickup-readout"));
    expect(screen.queryByTestId("pickup-chip-0")).toBeTruthy();
    expect(screen.queryByTestId("pickup-chip-1")).toBeTruthy();
    expect(screen.queryByTestId("pickup-chip-2")).toBeTruthy();
    expect(screen.queryByTestId("pickup-chip-3")).toBeFalsy();
  });
});
