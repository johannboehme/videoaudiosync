/**
 * Smoke + wiring test for the new Editor page.
 *
 * The heavy components (VideoCanvas, Timeline) touch Web Audio + Canvas, which
 * jsdom can't exercise meaningfully. We mock them at module level — the test
 * only verifies that:
 *   1. loading the page calls api.getJob and primes the store,
 *   2. the SyncTuner is mounted and shows the correct prefill,
 *   3. submitting includes sync_override_ms in the EditSpec.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { AuthProvider } from "../auth-context";

// Mock heavy components — keep the test focused on wiring.
vi.mock("../editor/components/VideoCanvas", () => ({
  VideoCanvas: () => <div data-testid="video-canvas-mock" />,
}));
vi.mock("../editor/components/Timeline", () => ({
  Timeline: () => <div data-testid="timeline-mock" />,
}));

const meMock = vi.fn();
const getJobMock = vi.fn();
const submitEditMock = vi.fn();

vi.mock("../api", async (importOriginal) => {
  const orig = (await importOriginal()) as Record<string, unknown>;
  return {
    ...orig,
    api: {
      me: () => meMock(),
      getJob: (id: string) => getJobMock(id),
      submitEdit: (id: string, spec: unknown) => submitEditMock(id, spec),
      waveformUrl: (id: string) => `/api/jobs/${id}/waveform`,
      thumbnailsUrl: (id: string) => `/api/jobs/${id}/thumbnails`,
      rawVideoUrl: (id: string) => `/api/jobs/${id}/raw-video`,
      rawAudioUrl: (id: string) => `/api/jobs/${id}/raw-audio`,
    },
  };
});

import Editor from "./Editor";
import { useEditorStore } from "../editor/store";

const fakeJob = {
  id: "abc",
  status: "done",
  kind: "edit",
  title: "Ray-Ban take 1",
  video_filename: "v.mp4",
  audio_filename: "a.wav",
  sync_offset_ms: 250,
  sync_confidence: 0.9,
  sync_drift_ratio: 1,
  sync_warning: null,
  duration_s: 60,
  width: 1920,
  height: 1080,
  fps: 30,
  progress_pct: 100,
  progress_stage: "done",
  progress_detail: null,
  progress_eta_s: null,
  error: null,
  edit_spec: null,
  has_output: true,
  bytes_in: 1,
  bytes_out: 1,
  created_at: "",
  started_at: null,
  finished_at: null,
};

function renderEditor() {
  // jsdom lacks ResizeObserver / fetch — stub minimally.
  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  }
  globalThis.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ peaks: [], duration: 60 }),
  }) as unknown as typeof fetch;

  return render(
    <MemoryRouter initialEntries={["/job/abc/edit"]}>
      <AuthProvider>
        <Routes>
          <Route path="/job/:id/edit" element={<Editor />} />
        </Routes>
      </AuthProvider>
    </MemoryRouter>,
  );
}

describe("Editor page", () => {
  beforeEach(() => {
    meMock.mockReset();
    getJobMock.mockReset();
    submitEditMock.mockReset();
    useEditorStore.getState().reset();
  });
  afterEach(() => vi.clearAllMocks());

  test("loads job, primes store with algo offset, mounts SyncTuner", async () => {
    meMock.mockResolvedValue({
      id: "u1",
      email: "x@y.com",
      last_sync_override_ms: -120,
    });
    getJobMock.mockResolvedValue(fakeJob);
    renderEditor();
    await waitFor(() => {
      expect(useEditorStore.getState().jobMeta?.id).toBe("abc");
    });
    expect(useEditorStore.getState().jobMeta?.algoOffsetMs).toBe(250);
    // Auto-learn prefilled
    expect(useEditorStore.getState().offset.userOverrideMs).toBe(-120);
    // SyncTuner is mounted (heading visible)
    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /Sync Tuner/i })).toBeInTheDocument(),
    );
  });

  test("Render button submits an EditSpec carrying sync_override_ms", async () => {
    meMock.mockResolvedValue({
      id: "u1",
      email: "x@y.com",
      last_sync_override_ms: 0,
    });
    getJobMock.mockResolvedValue(fakeJob);
    submitEditMock.mockResolvedValue({ ...fakeJob, status: "queued" });

    renderEditor();
    await waitFor(() =>
      expect(useEditorStore.getState().jobMeta?.id).toBe("abc"),
    );

    // Set a custom override so the spec is non-trivial
    useEditorStore.getState().setOffset(-87);

    const renderBtn = screen.getAllByRole("button", { name: /Render/i })[0];
    await userEvent.click(renderBtn);

    await waitFor(() => expect(submitEditMock).toHaveBeenCalled());
    const [, spec] = submitEditMock.mock.calls[0];
    expect(spec.sync_override_ms).toBe(-87);
    expect(spec.segments).toEqual([{ in: 0, out: 60 }]);
    expect(spec.export?.preset).toBe("web");
  });
});
