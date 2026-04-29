import { describe, it, expect, beforeEach } from "vitest";
import { useShortcutRegistry, registerShortcut } from "./registry";

function snapshot() {
  return useShortcutRegistry.getState().shortcuts;
}

describe("shortcut registry", () => {
  beforeEach(() => {
    useShortcutRegistry.setState({ shortcuts: [] });
  });

  it("starts empty", () => {
    expect(snapshot()).toEqual([]);
  });

  it("registers a shortcut and returns an unregister fn", () => {
    const off = registerShortcut({
      id: "play",
      keys: ["Space"],
      description: "Toggle play/pause",
      group: "Transport",
    });
    expect(snapshot()).toHaveLength(1);
    expect(snapshot()[0].id).toBe("play");
    off();
    expect(snapshot()).toEqual([]);
  });

  it("replaces a shortcut registered with the same id (StrictMode-safe)", () => {
    registerShortcut({ id: "play", keys: ["Space"], description: "v1" });
    registerShortcut({ id: "play", keys: ["Space"], description: "v2" });
    expect(snapshot()).toHaveLength(1);
    expect(snapshot()[0].description).toBe("v2");
  });

  it("preserves insertion order across multiple registers", () => {
    registerShortcut({ id: "a", keys: ["A"], description: "a" });
    registerShortcut({ id: "b", keys: ["B"], description: "b" });
    registerShortcut({ id: "c", keys: ["C"], description: "c" });
    expect(snapshot().map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("keeps insertion order when an existing id is re-registered", () => {
    registerShortcut({ id: "a", keys: ["A"], description: "a" });
    registerShortcut({ id: "b", keys: ["B"], description: "b" });
    registerShortcut({ id: "a", keys: ["A"], description: "a-updated" });
    const ids = snapshot().map((s) => s.id);
    expect(ids).toEqual(["a", "b"]);
    expect(snapshot()[0].description).toBe("a-updated");
  });

  it("unregister is idempotent", () => {
    const off = registerShortcut({ id: "x", keys: ["X"], description: "erase" });
    off();
    off();
    expect(snapshot()).toEqual([]);
  });
});
