import { beforeEach, describe, expect, test } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { SnapModeButtons } from "./SnapModeButtons";
import { useEditorStore } from "../store";

describe("SnapModeButtons", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore.getState().loadJob({
      id: "j1",
      fps: 30,
      duration: 60,
      width: 1920,
      height: 1080,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
  });

  test("renders all 7 mode buttons + the LOCK toggle", () => {
    render(<SnapModeButtons />);
    for (const m of ["off", "match", "1", "1/2", "1/4", "1/8", "1/16"]) {
      expect(screen.getByTestId(`snap-mode-${m}`)).toBeTruthy();
    }
    expect(screen.getByTestId("snap-lock")).toBeTruthy();
  });

  test("OFF is the active default", () => {
    render(<SnapModeButtons />);
    const off = screen.getByTestId("snap-mode-off");
    expect(off.getAttribute("aria-pressed")).toBe("true");
  });

  test("clicking a mode-button activates that mode (and only that one)", () => {
    useEditorStore.getState().setBpm({ value: 124, manualOverride: false });
    render(<SnapModeButtons />);
    fireEvent.click(screen.getByTestId("snap-mode-1/4"));
    expect(useEditorStore.getState().ui.snapMode).toBe("1/4");
    expect(screen.getByTestId("snap-mode-1/4").getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByTestId("snap-mode-off").getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  test("clicking match activates match mode", () => {
    render(<SnapModeButtons />);
    fireEvent.click(screen.getByTestId("snap-mode-match"));
    expect(useEditorStore.getState().ui.snapMode).toBe("match");
  });

  test("LOCK toggles lanesLocked in the store (default = locked)", () => {
    render(<SnapModeButtons />);
    expect(useEditorStore.getState().ui.lanesLocked).toBe(true);
    fireEvent.click(screen.getByTestId("snap-lock"));
    expect(useEditorStore.getState().ui.lanesLocked).toBe(false);
    fireEvent.click(screen.getByTestId("snap-lock"));
    expect(useEditorStore.getState().ui.lanesLocked).toBe(true);
  });

  test("grid-mode buttons are disabled when no BPM is detected", () => {
    // No BPM in jobMeta → grid modes can't snap, so disable buttons.
    render(<SnapModeButtons />);
    expect(
      screen.getByTestId("snap-mode-1/4").hasAttribute("disabled"),
    ).toBe(true);
    // OFF and MATCH stay enabled (they don't need BPM).
    expect(
      screen.getByTestId("snap-mode-off").hasAttribute("disabled"),
    ).toBe(false);
    expect(
      screen.getByTestId("snap-mode-match").hasAttribute("disabled"),
    ).toBe(false);
  });

  test("grid-mode buttons enabled once BPM is set", () => {
    useEditorStore.getState().setBpm({ value: 124, manualOverride: false });
    render(<SnapModeButtons />);
    expect(
      screen.getByTestId("snap-mode-1/4").hasAttribute("disabled"),
    ).toBe(false);
  });
});
