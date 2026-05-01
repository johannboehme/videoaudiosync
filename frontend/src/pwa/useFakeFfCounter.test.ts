import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { formatVcrTime, useFakeFfCounter } from "./useFakeFfCounter";

describe("formatVcrTime", () => {
  it("formats zero seconds as 00:00:00", () => {
    expect(formatVcrTime(0)).toBe("00:00:00");
  });

  it("formats sub-minute values with hours and minutes still padded", () => {
    expect(formatVcrTime(7)).toBe("00:00:07");
    expect(formatVcrTime(59)).toBe("00:00:59");
  });

  it("rolls minutes correctly", () => {
    expect(formatVcrTime(60)).toBe("00:01:00");
    expect(formatVcrTime(83)).toBe("00:01:23");
    expect(formatVcrTime(3599)).toBe("00:59:59");
  });

  it("rolls hours correctly", () => {
    expect(formatVcrTime(3600)).toBe("01:00:00");
    expect(formatVcrTime(7384)).toBe("02:03:04");
  });

  it("clamps negative or non-finite input to zero", () => {
    expect(formatVcrTime(-1)).toBe("00:00:00");
    expect(formatVcrTime(Number.NaN)).toBe("00:00:00");
    expect(formatVcrTime(Number.POSITIVE_INFINITY)).toBe("00:00:00");
  });
});

describe("useFakeFfCounter", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts at 0 when active", () => {
    const { result } = renderHook(() => useFakeFfCounter(true));
    expect(result.current).toBe(0);
  });

  it("ticks once per 100ms while active (10× FF speed)", () => {
    const { result } = renderHook(() => useFakeFfCounter(true));

    act(() => {
      vi.advanceTimersByTime(100);
    });
    expect(result.current).toBe(1);

    act(() => {
      vi.advanceTimersByTime(900);
    });
    expect(result.current).toBe(10);
  });

  it("does not tick while inactive", () => {
    const { result } = renderHook(() => useFakeFfCounter(false));
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(result.current).toBe(0);
  });

  it("resets to 0 when toggled off", () => {
    const { result, rerender } = renderHook(
      ({ active }) => useFakeFfCounter(active),
      { initialProps: { active: true } },
    );
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(result.current).toBe(5);

    rerender({ active: false });
    expect(result.current).toBe(0);
  });
});
