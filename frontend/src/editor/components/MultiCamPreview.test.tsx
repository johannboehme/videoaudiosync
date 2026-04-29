/**
 * Audio-master-clock layout invariants for `MultiCamPreview`.
 *
 * Pre-rewrite the preview returned a TestPattern early-return whenever
 * `clips[0]` was missing — and cam-1 owned the playback clock via its
 * <video> element. After the rewrite the master AUDIO drives the clock
 * and cams are passive layers, so the preview must:
 *   - render the OutputFrame + audio + FX layout even when no cams are
 *     resolvable (audio-only preview),
 *   - render correctly when cam-1 is missing but other cams exist,
 *   - render image-only "cams" without falling back to TestPattern.
 */
import { afterEach, beforeEach, describe, expect, vi, it } from "vitest";
import { render } from "@testing-library/react";
import { useEditorStore } from "../store";
import { MultiCamPreview } from "./MultiCamPreview";

// FxOverlay needs WebGL/canvas setup that isn't available in jsdom; the
// preview-shape tests don't depend on its actual rendering, so swap it out
// for a div the assertions can ignore.
vi.mock("./FxOverlay", () => ({
  FxOverlay: () => <div data-testid="fx-overlay-stub" />,
}));

const baseMeta = {
  id: "job",
  fps: 30,
  duration: 10,
  width: 1280,
  height: 720,
  algoOffsetMs: 0,
  driftRatio: 1,
};

afterEach(() => {
  useEditorStore.getState().reset();
});

beforeEach(() => {
  useEditorStore.getState().reset();
});

describe("MultiCamPreview — audio-driven layout", () => {
  it("does NOT fall back to TestPattern when audio is present but cam-1 is absent", () => {
    useEditorStore.getState().loadJob(baseMeta, {
      clips: [
        // cam-2 only — there is no cam at index 0 of the *resolved* cams
        // map (because cam-1 was removed by the user).
        {
          id: "cam-2",
          filename: "cam-2.mp4",
          color: "#f00",
          sourceDurationS: 5,
          syncOffsetMs: 0,
        },
      ],
    });
    const { container, queryByTestId } = render(
      <MultiCamPreview
        cams={{ "cam-2": { videoUrl: "blob:cam-2" } }}
        audioUrl="blob:master-audio"
      />,
    );
    // The audio-master element must mount even when no cam-1 video is
    // resolvable. The MultiCamPreview owns this element under the new
    // architecture (used to live inside cam-1's VideoCanvas).
    const masterAudio = container.querySelector(
      'audio[data-testid="master-audio"]',
    );
    expect(
      masterAudio,
      "expected the master <audio> element to be mounted",
    ).toBeTruthy();
    // No more "single-cam early-return" — the preview lays out cam-2 and
    // the FX overlay even though cam-1 is missing.
    expect(queryByTestId("fx-overlay-stub")).toBeTruthy();
  });

  it("renders the master <audio> + FX overlay even when no cams exist at all", () => {
    useEditorStore.getState().loadJob(baseMeta, { clips: [] });
    const { container, queryByTestId } = render(
      <MultiCamPreview cams={{}} audioUrl="blob:master-audio" />,
    );
    const masterAudio = container.querySelector(
      'audio[data-testid="master-audio"]',
    );
    expect(masterAudio).toBeTruthy();
    expect(queryByTestId("fx-overlay-stub")).toBeTruthy();
  });

  it("mounts an image cam at index 0 without crashing — cam-1 may be a still image", () => {
    useEditorStore.getState().loadJob(baseMeta, {
      clips: [
        {
          kind: "image",
          id: "img-1",
          filename: "still.png",
          color: "#0f0",
          durationS: 6,
        },
      ],
    });
    const { container } = render(
      <MultiCamPreview
        cams={{ "img-1": { videoUrl: "blob:img-1" } }}
        audioUrl="blob:master-audio"
      />,
    );
    const masterAudio = container.querySelector(
      'audio[data-testid="master-audio"]',
    );
    expect(masterAudio).toBeTruthy();
    // The image is rendered as <img>, not <video> — cam-1 was historically
    // assumed video.
    const img = container.querySelector('img[src="blob:img-1"]');
    expect(img).toBeTruthy();
  });
});
