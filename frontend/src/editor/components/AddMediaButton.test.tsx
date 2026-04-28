import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { AddMediaButton } from "./AddMediaButton";
import { useEditorStore } from "../store";

// Stub the job entry points so the test doesn't need OPFS / WASM.
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

  it("renders all three add modes", () => {
    render(<AddMediaButton jobId="job-x" />);
    expect(screen.getByTestId("add-media-sync")).toBeInTheDocument();
    expect(screen.getByTestId("add-media-broll")).toBeInTheDocument();
    expect(screen.getByTestId("add-media-image")).toBeInTheDocument();
  });

  it("IMAGE mode calls addImageToJob with the file", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "still.png", { type: "image/png" });
    const input = screen.getByTestId("add-media-image-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));
    expect(addImageToJob).toHaveBeenCalledWith("job-x", file);
  });

  it("SYNC mode calls addVideoToJob without skipSync", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "shot.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-sync-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    // Wait a microtask
    await new Promise((r) => setTimeout(r, 0));

    expect(addVideoToJob).toHaveBeenCalledWith("job-x", file, { skipSync: false });
  });

  it("B-ROLL mode calls addVideoToJob with skipSync: true", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "broll.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-broll-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));

    expect(addVideoToJob).toHaveBeenCalledWith("job-x", file, { skipSync: true });
  });

  it("multiple files trigger sequential addVideoToJob calls", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const f1 = new File(["a"], "a.mp4", { type: "video/mp4" });
    const f2 = new File(["b"], "b.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-sync-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [f1, f2], configurable: true });
    fireEvent.change(input);

    // Wait long enough for both awaits to settle.
    await new Promise((r) => setTimeout(r, 5));

    expect(addVideoToJob).toHaveBeenCalledTimes(2);
    expect(addVideoToJob).toHaveBeenNthCalledWith(1, "job-x", f1, { skipSync: false });
    expect(addVideoToJob).toHaveBeenNthCalledWith(2, "job-x", f2, { skipSync: false });
  });

  it("posts a notice on successful add", async () => {
    render(<AddMediaButton jobId="job-x" />);
    const file = new File(["dummy"], "shot.mp4", { type: "video/mp4" });
    const input = screen.getByTestId("add-media-sync-input") as HTMLInputElement;
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    await new Promise((r) => setTimeout(r, 0));
    expect(useEditorStore.getState().notice?.message).toMatch(/added/i);
  });
});
