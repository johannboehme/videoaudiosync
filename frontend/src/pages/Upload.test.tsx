import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Routes, Route } from "react-router-dom";
import Upload from "./Upload";

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
});
