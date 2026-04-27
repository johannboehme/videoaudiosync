import { describe, it, expect } from "vitest";

/**
 * Smoke-Test: das sync-core WASM-Modul lädt im echten Browser und liefert
 * die erwartete Version zurück. Damit ist die ganze Toolchain (Rust →
 * wasm-pack → vite Asset-Loading → JS Bindings) bewiesen — bevor wir die
 * eigentlichen Algorithmen schreiben.
 *
 * Wenn dieser Test rot wird, ist die WASM-Pipeline gebrochen und Phase 2
 * kann nicht starten.
 */
describe("sync-core WASM loads in real browser", () => {
  it("init() succeeds and version() returns the crate identifier", async () => {
    const mod = await import("../../../wasm/sync-core/pkg/sync_core.js");
    await mod.default();
    expect(mod.version()).toBe("sync-core/0.1.0");
  });
});
