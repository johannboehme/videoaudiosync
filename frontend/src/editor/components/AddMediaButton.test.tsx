import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AddMediaButton } from "./AddMediaButton";
import { useEditorStore } from "../store";

vi.mock("../../local/jobs", () => ({
  addVideoToJob: vi.fn(async () => "cam-2"),
  addImageToJob: vi.fn(async () => "cam-3"),
}));

import { addImageToJob, addVideoToJob } from "../../local/jobs";

describe("AddMediaButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEditorStore.getState().reset();
  });

  it("renders one add button + a match-audio toggle", () => {
    render(<AddMediaButton jobId="job-x" />);
    expect(screen.getByTestId("add-media-button")).toBeInTheDocument();
    expect(screen.getByTestId("add-media-match-toggle")).toBeInTheDocument();
  });

  it("routes a video file through addVideoToJob with the toggle's setting (default ON)", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "shot.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));
    expect(addVideoToJob).toHaveBeenCalledWith("job-x", file, {
      skipSync: false,
    });
  });

  it("toggling MATCH off causes videos to skip sync", async () => {
    render(<AddMediaButton jobId="job-x" />);
    fireEvent.click(screen.getByTestId("add-media-match-toggle"));
    expect(
      screen.getByTestId("add-media-match-toggle").getAttribute("aria-checked"),
    ).toBe("false");

    const file = new File(["dummy"], "broll.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));
    expect(addVideoToJob).toHaveBeenCalledWith("job-x", file, {
      skipSync: true,
    });
  });

  it("routes an image file through addImageToJob (toggle is irrelevant)", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "still.png", { type: "image/png" });
    const input = screen.getByTestId("add-media-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));
    expect(addImageToJob).toHaveBeenCalledWith("job-x", file);
    expect(addVideoToJob).not.toHaveBeenCalled();
  });

  it("a mixed selection dispatches to the correct entry per file", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const v = new File(["v"], "a.mp4", { type: "video/mp4" });
    const i = new File(["i"], "b.png", { type: "image/png" });
    const input = screen.getByTestId("add-media-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [v, i], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 5));
    expect(addVideoToJob).toHaveBeenCalledTimes(1);
    expect(addImageToJob).toHaveBeenCalledTimes(1);
  });

  it("posts a notice on success summarising what was added", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "shot.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));
    expect(useEditorStore.getState().notice?.message).toMatch(/added/i);
  });
});
