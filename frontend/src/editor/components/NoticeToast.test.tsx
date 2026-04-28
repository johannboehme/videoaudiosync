import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { NoticeToast } from "./NoticeToast";
import { useEditorStore } from "../store";

describe("NoticeToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useEditorStore.getState().reset();
  });

  it("is empty when there's no notice", () => {
    render(<NoticeToast />);
    expect(screen.queryByTestId("editor-notice")).not.toBeInTheDocument();
  });

  it("renders the notice when one is pushed", () => {
    render(<NoticeToast />);
    act(() => {
      useEditorStore.getState().pushNotice("hello");
    });
    expect(screen.getByTestId("editor-notice")).toHaveTextContent("hello");
  });

  it("auto-dismisses after the visible window", () => {
    render(<NoticeToast />);
    act(() => {
      useEditorStore.getState().pushNotice("auto");
    });
    expect(screen.getByTestId("editor-notice")).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(useEditorStore.getState().notice).toBeNull();
  });
});
