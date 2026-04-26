import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import JobPage from "./JobPage";

const getJobMock = vi.fn();
const subscribeJobMock = vi.fn();
const downloadUrlMock = vi.fn((id: string) => `/api/jobs/${id}/download`);

vi.mock("../api", () => ({
  api: {
    getJob: (id: string) => getJobMock(id),
    subscribeJob: (id: string, cb: (e: unknown) => void) => subscribeJobMock(id, cb),
    downloadUrl: (id: string) => downloadUrlMock(id),
  },
}));

function makeJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    status: "queued",
    kind: "sync",
    title: "My take",
    video_filename: "v.mp4",
    audio_filename: "a.wav",
    sync_offset_ms: null,
    sync_confidence: null,
    sync_drift_ratio: null,
    sync_warning: null,
    duration_s: null,
    width: null,
    height: null,
    progress_pct: 0,
    progress_stage: "queued",
    error: null,
    edit_spec: null,
    has_output: false,
    bytes_in: 1000,
    bytes_out: 0,
    created_at: "2026-04-26T00:00:00Z",
    started_at: null,
    finished_at: null,
    ...overrides,
  };
}

function renderRouted() {
  return render(
    <MemoryRouter initialEntries={["/job/j1"]}>
      <Routes>
        <Route path="/job/:id" element={<JobPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("JobPage", () => {
  beforeEach(() => {
    getJobMock.mockReset();
    subscribeJobMock.mockReset();
    subscribeJobMock.mockReturnValue(() => {});
  });
  afterEach(() => vi.clearAllMocks());

  it("shows the job title and current stage", async () => {
    getJobMock.mockResolvedValueOnce(makeJob({ status: "analyzing", progress_stage: "analyzing", progress_pct: 25 }));
    renderRouted();
    await waitFor(() => expect(screen.getByText(/my take/i)).toBeInTheDocument());
    expect(screen.getByText(/analyzing/i)).toBeInTheDocument();
  });

  it("subscribes to SSE and updates progress as events arrive", async () => {
    getJobMock.mockResolvedValueOnce(makeJob({ status: "analyzing", progress_pct: 10, progress_stage: "analyzing" }));
    let cb: (e: unknown) => void = () => {};
    subscribeJobMock.mockImplementation((_id: string, c: (e: unknown) => void) => {
      cb = c;
      return () => {};
    });
    renderRouted();
    await waitFor(() => expect(subscribeJobMock).toHaveBeenCalled());

    cb({ stage: "rendering", progress: 70, status: "rendering" });
    await waitFor(() => expect(screen.getByText(/rendering/i)).toBeInTheDocument());
  });

  it("shows download button when job is done", async () => {
    getJobMock.mockResolvedValueOnce(
      makeJob({ status: "done", has_output: true, progress_pct: 100 }),
    );
    renderRouted();
    await waitFor(() =>
      expect(screen.getByRole("link", { name: /download/i })).toHaveAttribute(
        "href",
        "/api/jobs/j1/download",
      ),
    );
  });

  it("shows error message when job failed", async () => {
    getJobMock.mockResolvedValueOnce(makeJob({ status: "failed", error: "ffmpeg crashed" }));
    renderRouted();
    await waitFor(() => expect(screen.getByText(/ffmpeg crashed/i)).toBeInTheDocument());
  });

  it("shows sync warning when present", async () => {
    getJobMock.mockResolvedValueOnce(
      makeJob({
        status: "done",
        has_output: true,
        sync_offset_ms: 400,
        sync_confidence: 0.2,
        sync_warning: "Low sync confidence",
      }),
    );
    renderRouted();
    await waitFor(() => expect(screen.getByText(/low sync confidence/i)).toBeInTheDocument());
  });

  it("Open editor button navigates to /job/:id/edit", async () => {
    getJobMock.mockResolvedValueOnce(makeJob({ status: "done", has_output: true }));
    renderRouted();
    const link = await screen.findByRole("link", { name: /open editor/i });
    expect(link).toHaveAttribute("href", "/job/j1/edit");
  });
});
