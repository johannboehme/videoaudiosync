import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test } from "vitest";
import { useEditorStore } from "../store";
import { TrimPanel } from "./TrimPanel";

describe("<TrimPanel />", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 30,
      width: 1920,
      height: 1080,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
  });

  test("IN @ Playhead sets trim.in to currentTime", async () => {
    useEditorStore.getState().setCurrentTime(5);
    render(<TrimPanel />);
    await userEvent.click(screen.getByRole("button", { name: /IN @ Playhead/i }));
    expect(useEditorStore.getState().trim.in).toBe(5);
  });

  test("OUT @ Playhead sets trim.out to currentTime", async () => {
    useEditorStore.getState().setCurrentTime(10);
    render(<TrimPanel />);
    await userEvent.click(screen.getByRole("button", { name: /OUT @ Playhead/i }));
    expect(useEditorStore.getState().trim.out).toBe(10);
  });

  test("RESET (FULL) restores trim to full duration", async () => {
    useEditorStore.getState().setTrim({ in: 5, out: 10 });
    render(<TrimPanel />);
    await userEvent.click(screen.getByRole("button", { name: /RESET/i }));
    expect(useEditorStore.getState().trim).toEqual({ in: 0, out: 30 });
  });
});
