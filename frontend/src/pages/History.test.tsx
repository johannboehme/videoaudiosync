import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import History from "./History";

const listJobsMock = vi.fn();
const deleteJobMock = vi.fn();
vi.mock("../api", () => ({
  api: {
    listJobs: () => listJobsMock(),
    deleteJob: (id: string) => deleteJobMock(id),
    downloadUrl: (id: string) => `/api/jobs/${id}/download`,
  },
}));

const baseJob = {
  kind: "sync",
  video_filename: "v.mp4",
  audio_filename: "a.wav",
  sync_offset_ms: 400,
  sync_confidence: 0.9,
  sync_drift_ratio: 1,
  sync_warning: null,
  duration_s: 30,
  width: 1280,
  height: 720,
  progress_pct: 100,
  progress_stage: "done",
  progress_detail: null,
  progress_eta_s: null,
  error: null,
  edit_spec: null,
  bytes_in: 0,
  bytes_out: 0,
  started_at: null,
  finished_at: null,
};

describe("History page", () => {
  beforeEach(() => {
    listJobsMock.mockReset();
    deleteJobMock.mockReset();
  });
  afterEach(() => vi.clearAllMocks());

  it("shows an empty-state message when there are no jobs", async () => {
    listJobsMock.mockResolvedValueOnce([]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText(/no jobs yet/i)).toBeInTheDocument());
  });

  it("lists jobs with title, status, and a link to the job page", async () => {
    listJobsMock.mockResolvedValueOnce([
      { id: "j1", status: "done", title: "Take 1", has_output: true, created_at: "2026-04-26T00:00:00Z", ...baseJob },
      { id: "j2", status: "rendering", title: "Take 2", has_output: false, created_at: "2026-04-25T00:00:00Z", ...baseJob },
    ]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());
    expect(screen.getByText("Take 2")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /take 1/i })).toHaveAttribute("href", "/job/j1");
  });

  it("shows an inline progress bar with percent for jobs that are still running", async () => {
    listJobsMock.mockResolvedValueOnce([
      {
        id: "j-rendering",
        status: "rendering",
        title: "Live job",
        has_output: false,
        created_at: "2026-04-26T00:00:00Z",
        ...baseJob,
        progress_stage: "rendering",
        progress_pct: 45,
      },
    ]);
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Live job")).toBeInTheDocument());
    const bar = screen.getByRole("progressbar");
    expect(bar).toHaveAttribute("aria-valuenow", "45");
    expect(screen.getByText(/45\s*%/)).toBeInTheDocument();
  });

  it("deletes a job after confirming and removes it from the list", async () => {
    listJobsMock.mockResolvedValueOnce([
      { id: "j1", status: "done", title: "Take 1", has_output: true, created_at: "2026-04-26T00:00:00Z", ...baseJob },
    ]);
    deleteJobMock.mockResolvedValueOnce(undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <History />
      </MemoryRouter>,
    );
    await waitFor(() => expect(screen.getByText("Take 1")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await waitFor(() => expect(screen.queryByText("Take 1")).not.toBeInTheDocument());
    expect(deleteJobMock).toHaveBeenCalledWith("j1");
  });
});
