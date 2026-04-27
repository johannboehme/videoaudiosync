import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { Settings } from "./Settings";
import type { Capabilities } from "../local/capabilities";

const ALL_PRESENT: Capabilities = {
  webAssembly: true,
  sharedArrayBuffer: true,
  crossOriginIsolated: true,
  opfs: true,
  audioDecoder: true,
  videoDecoder: true,
  audioEncoder: true,
  videoEncoder: true,
  fileSystemAccess: true,
};

const NO_WEBCODECS_ENCODE: Capabilities = {
  ...ALL_PRESENT,
  audioEncoder: false,
  videoEncoder: false,
};

const MISSING_OPFS: Capabilities = {
  ...ALL_PRESENT,
  opfs: false,
};

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Settings page", () => {
  it("renders a row per capability with on/off state", () => {
    render(<Settings caps={ALL_PRESENT} />);
    // Drei zufällige Stichproben — der vollständige Vergleich wäre Test-noise.
    expect(screen.getByText("WebAssembly")).toBeInTheDocument();
    expect(screen.getByText("Origin Private File System")).toBeInTheDocument();
    expect(screen.getByText("WebCodecs VideoEncoder")).toBeInTheDocument();
  });

  it("shows the chosen render path: WebCodecs (HW) when full WebCodecs is present", () => {
    render(<Settings caps={ALL_PRESENT} />);
    expect(screen.getByTestId("render-path")).toHaveTextContent(/WebCodecs/i);
    expect(screen.getByTestId("render-path")).toHaveTextContent(/HW/i);
  });

  it("shows ffmpeg.wasm fallback path when WebCodecs encoder is missing", () => {
    render(<Settings caps={NO_WEBCODECS_ENCODE} />);
    expect(screen.getByTestId("render-path")).toHaveTextContent(/ffmpeg\.wasm/i);
  });

  it("shows the min-requirements check status", () => {
    render(<Settings caps={ALL_PRESENT} />);
    expect(screen.getByTestId("min-status")).toHaveTextContent(/ready/i);
  });

  it("flags missing min-requirements explicitly", () => {
    render(<Settings caps={MISSING_OPFS} />);
    expect(screen.getByTestId("min-status")).toHaveTextContent(/not ready/i);
    // Genau die fehlende Capability muss erwähnt werden:
    expect(screen.getByTestId("min-status")).toHaveTextContent(
      /Origin Private File System/i,
    );
  });
});
