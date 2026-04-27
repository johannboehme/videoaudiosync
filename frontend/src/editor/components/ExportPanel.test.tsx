import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useEditorStore } from "../store";
import { ExportPanel } from "./ExportPanel";

function mountAt(width: number, height: number) {
  useEditorStore.getState().reset();
  useEditorStore.getState().loadJob({
    id: "j",
    fps: 30,
    duration: 60,
    width,
    height,
    algoOffsetMs: 0,
    driftRatio: 1,
  });
}

describe("<ExportPanel />", () => {
  beforeEach(() => {
    mountAt(1920, 1080);
  });

  test("default preset is web with H.264 and the Good-quality bitrate at 1080p", () => {
    render(<ExportPanel onSubmit={() => undefined} submitting={false} />);
    const ex = useEditorStore.getState().exportSpec;
    expect(ex.preset).toBe("web");
    expect(ex.video_codec).toBe("h264");
    // Good @ 1080p = 3500 kbps (see exportPresets.qualityToBitrates).
    expect(ex.video_bitrate_kbps).toBe(3500);
  });

  test("MOBILE preset preserves aspect for portrait sources (the bug fix)", async () => {
    mountAt(1080, 1920);
    render(<ExportPanel onSubmit={() => undefined} submitting={false} />);
    const mobileTab = screen.getByRole("tab", { name: /MOBILE/i });
    await userEvent.click(mobileTab);
    const ex = useEditorStore.getState().exportSpec;
    expect(ex.preset).toBe("mobile");
    // Portrait source within the long-side cap stays 1080×1920 — the old
    // hardcoded 1280×720 was wrong for portrait phone footage.
    expect(ex.resolution).toEqual({ w: 1080, h: 1920 });
  });

  test("MOBILE preset caps a 4K landscape source on its long side", async () => {
    mountAt(3840, 2160);
    render(<ExportPanel onSubmit={() => undefined} submitting={false} />);
    const mobileTab = screen.getByRole("tab", { name: /MOBILE/i });
    await userEvent.click(mobileTab);
    const ex = useEditorStore.getState().exportSpec;
    expect(ex.resolution).toEqual({ w: 1920, h: 1080 });
  });

  test("ARCHIVE preset switches to H.265 and keeps source dimensions", async () => {
    mountAt(3840, 2160);
    render(<ExportPanel onSubmit={() => undefined} submitting={false} />);
    const archiveTab = screen.getByRole("tab", { name: /ARCHIVE/i });
    await userEvent.click(archiveTab);
    const ex = useEditorStore.getState().exportSpec;
    expect(ex.preset).toBe("archive");
    expect(ex.video_codec).toBe("h265");
    expect(ex.resolution).toEqual({ w: 3840, h: 2160 });
  });

  test("Render button calls onSubmit", async () => {
    const onSubmit = vi.fn();
    render(<ExportPanel onSubmit={onSubmit} submitting={false} />);
    const btn = screen.getByRole("button", { name: /^Render$/i });
    await userEvent.click(btn);
    expect(onSubmit).toHaveBeenCalled();
  });

  test("submitting disables the Render button", () => {
    render(<ExportPanel onSubmit={() => undefined} submitting={true} />);
    const btn = screen.getByRole("button", { name: /Submitting/i });
    expect(btn).toBeDisabled();
  });
});
