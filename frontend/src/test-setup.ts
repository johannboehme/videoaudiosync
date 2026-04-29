import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// jsdom doesn't ship ResizeObserver; the editor's OutputFrameBox uses it
// to track its container's CSS bounds. A no-op polyfill is enough — the
// component falls back gracefully to a 0×0 box, which is fine for tests
// that only assert structural mount.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}
