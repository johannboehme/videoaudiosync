import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useInstallProgress } from "./useInstallProgress";

interface FakeSw {
  controller: ServiceWorker | null;
  ready?: Promise<{ active: ServiceWorker | null }>;
  addEventListener?: (type: string, listener: EventListener) => void;
  removeEventListener?: (type: string, listener: EventListener) => void;
  fire?: (type: string) => void;
}

function makeSw(opts: {
  controller?: ServiceWorker | null;
  ready?: Promise<{ active: ServiceWorker | null }>;
} = {}): FakeSw {
  const listeners = new Map<string, EventListener[]>();
  const sw: FakeSw = {
    controller: opts.controller ?? null,
    ready: opts.ready,
    addEventListener(type, listener) {
      const arr = listeners.get(type) ?? [];
      arr.push(listener);
      listeners.set(type, arr);
    },
    removeEventListener(type, listener) {
      const arr = listeners.get(type) ?? [];
      listeners.set(
        type,
        arr.filter((l) => l !== listener),
      );
    },
    fire(type) {
      (listeners.get(type) ?? []).forEach((l) => l(new Event(type)));
    },
  };
  return sw;
}

function setSw(value: FakeSw | undefined): void {
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
    setSw(makeSw({ controller: null }));
  });

  it("hides the overlay on a repeat visit (controller already exists at mount)", () => {
    setSw(makeSw({ controller: {} as ServiceWorker }));

    const { result } = renderHook(() => useInstallProgress(false));

    expect(result.current.visible).toBe(false);
  });

  it("shows the overlay on first install (no controller, offlineReady false)", () => {
    setSw(makeSw({ controller: null }));

    const { result } = renderHook(() => useInstallProgress(false));

    expect(result.current.visible).toBe(true);
    expect(result.current.slowMode).toBe(false);
  });

  it("hides the overlay once offlineReady flips to true", () => {
    setSw(makeSw({ controller: null }));

    const { result, rerender } = renderHook(
      ({ ready }) => useInstallProgress(ready),
      { initialProps: { ready: false } },
    );
    expect(result.current.visible).toBe(true);

    rerender({ ready: true });
    expect(result.current.visible).toBe(false);
  });

  it("enters slow mode after 90s of being visible", () => {
    setSw(makeSw({ controller: null }));

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
    setSw(makeSw({ controller: {} as ServiceWorker }));

    const { result } = renderHook(() => useInstallProgress(false));

    act(() => {
      vi.advanceTimersByTime(120_000);
    });
    expect(result.current.slowMode).toBe(false);
    expect(result.current.visible).toBe(false);
  });

  it("treats missing serviceWorker support as 'no install in progress'", () => {
    setSw(undefined);

    const { result } = renderHook(() => useInstallProgress(false));

    expect(result.current.visible).toBe(false);
  });

  // Regression: the user reported the overlay sticking on a repeat visit
  // where `controller` was momentarily null at mount but the SW was already
  // installed. `offlineReady` only fires on the very first install, so the
  // overlay must also hide when the SW is otherwise observably ready.
  it("hides the overlay when sw.ready resolves with an active registration", async () => {
    const activeWorker = {} as ServiceWorker;
    const ready = Promise.resolve({ active: activeWorker });
    setSw(makeSw({ controller: null, ready }));

    const { result } = renderHook(() => useInstallProgress(false));
    expect(result.current.visible).toBe(true);

    await act(async () => {
      await ready;
    });

    expect(result.current.visible).toBe(false);
  });

  it("hides the overlay when controllerchange fires after a new controller appears", async () => {
    const sw = makeSw({ controller: null });
    setSw(sw);

    const { result } = renderHook(() => useInstallProgress(false));
    expect(result.current.visible).toBe(true);

    await act(async () => {
      sw.controller = {} as ServiceWorker;
      sw.fire?.("controllerchange");
    });

    expect(result.current.visible).toBe(false);
  });
});
