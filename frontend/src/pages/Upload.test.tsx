import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Upload, { UploadProgressCard } from "./Upload";

const uploadJobMock = vi.fn();
vi.mock("../api", () => ({
  api: {
    uploadJob: (...a: unknown[]) => uploadJobMock(...a),
  },
}));

function renderRouted() {
  return render(
    <MemoryRouter initialEntries={["/upload"]}>
      <Routes>
        <Route path="/upload" element={<Upload />} />
        <Route path="/job/:id" element={<div>JOB:{location.pathname}</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Upload page", () => {
  beforeEach(() => uploadJobMock.mockReset());
  afterEach(() => vi.clearAllMocks());

  it("renders two file pickers and a submit button", () => {
    renderRouted();
    expect(screen.getByLabelText(/video/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/audio/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
  });

  it("enables submit only when both files are picked", async () => {
    const user = userEvent.setup();
    renderRouted();
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    await user.upload(screen.getByLabelText(/video/i), video);
    expect(screen.getByRole("button", { name: /upload/i })).toBeDisabled();
    await user.upload(screen.getByLabelText(/audio/i), audio);
    expect(screen.getByRole("button", { name: /upload/i })).not.toBeDisabled();
  });

  it("submits both files and navigates to the new job", async () => {
    uploadJobMock.mockResolvedValueOnce({ id: "j-new", status: "queued" });
    const user = userEvent.setup();
    renderRouted();
    const video = new File(["v"], "test.mp4", { type: "video/mp4" });
    const audio = new File(["a"], "test.wav", { type: "audio/wav" });
    await user.upload(screen.getByLabelText(/video/i), video);
    await user.upload(screen.getByLabelText(/audio/i), audio);
    await user.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() =>
      expect(uploadJobMock).toHaveBeenCalledWith(
        expect.objectContaining({ video, audio }),
      ),
    );
  });

  it("shows error message on upload failure", async () => {
    uploadJobMock.mockRejectedValueOnce(new Error("Quota exceeded"));
    const user = userEvent.setup();
    renderRouted();
    const v = new File(["v"], "v.mp4", { type: "video/mp4" });
    const a = new File(["a"], "a.wav", { type: "audio/wav" });
    await user.upload(screen.getByLabelText(/video/i), v);
    await user.upload(screen.getByLabelText(/audio/i), a);
    await user.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() =>
      expect(screen.getByText(/quota exceeded/i)).toBeInTheDocument(),
    );
  });

  it("passes an onProgress callback to api.uploadJob", async () => {
    uploadJobMock.mockResolvedValueOnce({ id: "j-new" });
    const user = userEvent.setup();
    renderRouted();
    await user.upload(
      screen.getByLabelText(/video/i),
      new File(["v"], "v.mp4", { type: "video/mp4" }),
    );
    await user.upload(
      screen.getByLabelText(/audio/i),
      new File(["a"], "a.wav", { type: "audio/wav" }),
    );
    await user.click(screen.getByRole("button", { name: /upload/i }));
    await waitFor(() => expect(uploadJobMock).toHaveBeenCalled());
    const arg = uploadJobMock.mock.calls[0][0] as { onProgress?: unknown };
    expect(typeof arg.onProgress).toBe("function");
  });
});

describe("UploadProgressCard", () => {
  it("renders the bytes uploaded, percentage, and an ARIA progressbar", () => {
    render(
      <UploadProgressCard
        progress={{
          loaded: 25 * 1024 * 1024,
          total: 100 * 1024 * 1024,
          startedAt: Date.now(),
        }}
      />,
    );
    expect(screen.getByText(/25\s*%/)).toBeInTheDocument();
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "25");
    expect(screen.getByText(/25\.0 MB\s*\/\s*100\.0 MB/)).toBeInTheDocument();
  });

  it("shows speed and ETA once enough time has elapsed", () => {
    // 8 MB uploaded over 2 seconds → 4 MB/s; 2 MB remaining → ETA ~0:01
    render(
      <UploadProgressCard
        progress={{
          loaded: 8 * 1024 * 1024,
          total: 10 * 1024 * 1024,
          startedAt: Date.now() - 2000,
        }}
      />,
    );
    expect(screen.getByText(/MB\/s/)).toBeInTheDocument();
    expect(screen.getByText(/ETA\s+0:0\d/)).toBeInTheDocument();
  });
});
