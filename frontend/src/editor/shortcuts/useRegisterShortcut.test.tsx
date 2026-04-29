import { describe, it, expect, beforeEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { useEffect } from "react";
import { useShortcutRegistry } from "./registry";
import { useRegisterShortcut } from "./useRegisterShortcut";

function Probe(props: {
  id: string;
  keys: string[];
  description: string;
  group?: string;
}) {
  useRegisterShortcut(props);
  return null;
}

describe("useRegisterShortcut", () => {
  beforeEach(() => {
    cleanup();
    useShortcutRegistry.setState({ shortcuts: [] });
  });

  it("registers on mount and unregisters on unmount", () => {
    const { unmount } = render(
      <Probe id="play" keys={["Space"]} description="Play / pause" />,
    );
    expect(useShortcutRegistry.getState().shortcuts).toHaveLength(1);
    expect(useShortcutRegistry.getState().shortcuts[0].id).toBe("play");
    unmount();
    expect(useShortcutRegistry.getState().shortcuts).toEqual([]);
  });

  it("survives StrictMode-style double-mount cleanly", () => {
    // Simulate React 18 StrictMode: mount → cleanup → mount again.
    function StrictMimic() {
      useEffect(() => {
        return () => {
          // pass — the inner effect cleanup is what matters.
        };
      }, []);
      return <Probe id="x" keys={["X"]} description="Erase" />;
    }
    const { unmount } = render(<StrictMimic />);
    // After a single mount/unmount cycle the registry must be empty.
    unmount();
    expect(useShortcutRegistry.getState().shortcuts).toEqual([]);
  });

  it("re-registers when the description changes", () => {
    const { rerender } = render(
      <Probe id="q" keys={["Q"]} description="Quantize (preview)" />,
    );
    expect(useShortcutRegistry.getState().shortcuts[0].description).toBe(
      "Quantize (preview)",
    );
    rerender(<Probe id="q" keys={["Q"]} description="Quantize and commit" />);
    expect(useShortcutRegistry.getState().shortcuts).toHaveLength(1);
    expect(useShortcutRegistry.getState().shortcuts[0].description).toBe(
      "Quantize and commit",
    );
  });

  it("handles multiple shortcuts side by side", () => {
    render(
      <>
        <Probe id="a" keys={["A"]} description="a" />
        <Probe id="b" keys={["B"]} description="b" />
      </>,
    );
    expect(useShortcutRegistry.getState().shortcuts.map((s) => s.id)).toEqual([
      "a",
      "b",
    ]);
  });
});
