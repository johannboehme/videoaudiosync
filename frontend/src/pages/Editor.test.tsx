import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import Editor from "./Editor";

const getJobMock = vi.fn();
const submitEditMock = vi.fn();
const previewUrlMock = vi.fn((id: string) => `/api/jobs/${id}/preview`);
const waveformUrlMock = vi.fn((id: string) => `/api/jobs/${id}/waveform`);

vi.mock("../api", () => ({
  api: {
    getJob: (id: string) => getJobMock(id),
    submitEdit: (id: string, spec: unknown) => submitEditMock(id, spec),
    previewUrl: (id: string) => previewUrlMock(id),
    waveformUrl: (id: string) => waveformUrlMock(id),
  },
}));

const baseJob = {
  id: "j1",
  status: "done",
  kind: "sync",
  title: "My take",
  video_filename: "v.mp4",
  audio_filename: "a.wav",
  sync_offset_ms: 400,
  sync_confidence: 0.9,
  sync_drift_ratio: 1,
  sync_warning: null,
  duration_s: 10,
  width: 1280,
  height: 720,
  progress_pct: 100,
  progress_stage: "done",
  error: null,
  edit_spec: null,
  has_output: true,
  bytes_in: 1,
  bytes_out: 1,
  created_at: "2026-04-26T00:00:00Z",
  started_at: null,
  finished_at: null,
};

beforeEach(() => {
  getJobMock.mockReset();
  submitEditMock.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ peaks: [[-0.5, 0.5]], duration: 10 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    ),
  );
});
afterEach(() => vi.clearAllMocks());

function renderRouted() {
  return render(
    <MemoryRouter initialEntries={["/job/j1/edit"]}>
      <Routes>
        <Route path="/job/:id/edit" element={<Editor />} />
        <Route path="/job/:id" element={<div>JOB</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Editor page", () => {
  it("loads the job and shows the video preview source", async () => {
    getJobMock.mockResolvedValueOnce({ ...baseJob });
    renderRouted();
    await waitFor(() =>
      expect(screen.getByTestId("preview-video")).toHaveAttribute(
        "src",
        "/api/jobs/j1/preview",
      ),
    );
  });

  it("lets user add a text overlay and the spec preview reflects it", async () => {
    getJobMock.mockResolvedValueOnce({ ...baseJob });
    const user = userEvent.setup();
    renderRouted();
    await waitFor(() => screen.getByTestId("preview-video"));

    await user.click(screen.getByRole("button", { name: /add text overlay/i }));
    const textInput = await screen.findByLabelText(/text/i);
    await user.clear(textInput);
    await user.type(textInput, "Hello World");

    expect(screen.getByDisplayValue(/hello world/i)).toBeInTheDocument();
  });

  it("submits an edit spec containing the overlay and trim", async () => {
    getJobMock.mockResolvedValueOnce({ ...baseJob });
    submitEditMock.mockResolvedValueOnce({ ...baseJob, status: "queued" });
    const user = userEvent.setup();
    renderRouted();
    await waitFor(() => screen.getByTestId("preview-video"));

    // add an overlay
    await user.click(screen.getByRole("button", { name: /add text overlay/i }));
    await user.clear(screen.getByLabelText(/text/i));
    await user.type(screen.getByLabelText(/text/i), "Drop");

    // pick a visualizer
    await user.selectOptions(screen.getByLabelText(/visualizer/i), "showcqt");

    // hit Render
    await user.click(screen.getByRole("button", { name: /render/i }));

    await waitFor(() =>
      expect(submitEditMock).toHaveBeenCalledWith(
        "j1",
        expect.objectContaining({
          version: 1,
          overlays: expect.arrayContaining([
            expect.objectContaining({ type: "text", text: "Drop" }),
          ]),
          visualizer: expect.objectContaining({ type: "showcqt" }),
        }),
      ),
    );
  });

  it("lets the user remove an overlay", async () => {
    getJobMock.mockResolvedValueOnce({ ...baseJob });
    const user = userEvent.setup();
    renderRouted();
    await waitFor(() => screen.getByTestId("preview-video"));
    await user.click(screen.getByRole("button", { name: /add text overlay/i }));
    expect(screen.getByLabelText(/text/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(screen.queryByLabelText(/text/i)).not.toBeInTheDocument();
  });
});
