import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useEditorStore } from "../store";
import { ExportPanel } from "./ExportPanel";

describe("<ExportPanel />", () => {
  beforeEach(() => {
    useEditorStore.getState().reset();
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 60,
      width: 1920,
      height: 1080,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
  });

  test("default preset is web with H.264 5000kbps", () => {
    render(<ExportPanel onSubmit={() => undefined} submitting={false} />);
    expect(useEditorStore.getState().exportSpec.preset).toBe("web");
    expect(useEditorStore.getState().exportSpec.video_bitrate_kbps).toBe(5000);
  });

  test("selecting MOBILE preset switches resolution to 1280×720", async () => {
    render(<ExportPanel onSubmit={() => undefined} submitting={false} />);
    const mobileTab = screen.getByRole("tab", { name: /MOBILE/i });
    await userEvent.click(mobileTab);
    const ex = useEditorStore.getState().exportSpec;
    expect(ex.preset).toBe("mobile");
    expect(ex.resolution).toEqual({ w: 1280, h: 720 });
  });

  test("Render button calls onSubmit", async () => {
    const onSubmit = vi.fn();
    render(<ExportPanel onSubmit={onSubmit} submitting={false} />);
    const btn = screen.getByRole("button", { name: /Render/i });
    await userEvent.click(btn);
    expect(onSubmit).toHaveBeenCalled();
  });

  test("submitting disables the Render button", () => {
    render(<ExportPanel onSubmit={() => undefined} submitting={true} />);
    const btn = screen.getByRole("button", { name: /Submitting/i });
    expect(btn).toBeDisabled();
  });
});
