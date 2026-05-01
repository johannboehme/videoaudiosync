import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInstallProgress } from "./useInstallProgress";

type SwMock = { controller: ServiceWorker | null } | undefined;

function setController(value: SwMock): void {
  Object.defineProperty(globalThis.navigator, "serviceWorker", {
    configurable: true,
    value,
  });
}

describe("useInstallProgress", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore to a benign default — happy-dom/jsdom don't restore navigator
    // descriptors between tests.
    setController({ controller: null });
  });

  it("hides the overlay on a repeat visit (controller already exists at mount)", () => {
    setController({ controller: {} as ServiceWorker });

    const { result } = renderHook(() => useInstallProgress(false));

    expect(result.current.visible).toBe(false);
  });

  it("shows the overlay on first install (no controller, offlineReady false)", () => {
    setController({ controller: null });

    const { result } = renderHook(() => useInstallProgress(false));

    expect(result.current.visible).toBe(true);
    expect(result.current.slowMode).toBe(false);
  });

  it("hides the overlay once offlineReady flips to true", () => {
    setController({ controller: null });

    const { result, rerender } = renderHook(
      ({ ready }) => useInstallProgress(ready),
      { initialProps: { ready: false } },
    );
    expect(result.current.visible).toBe(true);

    rerender({ ready: true });
    expect(result.current.visible).toBe(false);
  });

  it("enters slow mode after 90s of being visible", () => {
    setController({ controller: null });

    const { result } = renderHook(() => useInstallProgress(false));
    expect(result.current.slowMode).toBe(false);

    act(() => {
      vi.advanceTimersByTime(89_999);
    });
    expect(result.current.slowMode).toBe(false);

    act(() => {
      vi.advanceTimersByTime(2);
    });
    expect(result.current.slowMode).toBe(true);
  });

  it("does not arm the slow-mode timer if the overlay is hidden", () => {
    setController({ controller: {} as ServiceWorker });

    const { result } = renderHook(() => useInstallProgress(false));

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current.slowMode).toBe(false);
    expect(result.current.visible).toBe(false);
  });

  it("treats missing serviceWorker support as 'no install in progress'", () => {
    setController(undefined);

    const { result } = renderHook(() => useInstallProgress(false));

    expect(result.current.visible).toBe(false);
  });
});
