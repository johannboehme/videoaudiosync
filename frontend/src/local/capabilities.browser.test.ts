import { describe, it, expect } from "vitest";
import { detectCapabilities, meetsMinRequirements } from "./capabilities";

/**
 * Smoke-Test im echten Chromium (vitest-browser, Playwright Provider).
 *
 * Diese Tests prüfen die ECHTE Browser-Realität — jsdom-Tests in
 * `capabilities.test.ts` decken die Logik mit Mocks ab, hier verifizieren
 * wir, dass die Detection auf echtem Chromium plausibel ist.
 *
 * Wichtig: COOP/COEP-Header sind in vite.config.ts gesetzt, daher MUSS
 * crossOriginIsolated === true sein. Wenn dieser Test rot wird, ist das
 * Setup gebrochen und der Plan kann ohne SharedArrayBuffer/WASM-Threads
 * nicht funktionieren.
 */
describe("capabilities (real Chromium)", () => {
  it("the test environment is cross-origin isolated", () => {
    // Wenn das fehlschlägt, sind die COOP/COEP-Header in vite.config.ts kaputt.
    expect(globalThis.crossOriginIsolated).toBe(true);
  });

  it("Chromium supports all min requirements", () => {
    const caps = detectCapabilities();
    const result = meetsMinRequirements(caps);
    expect(result.ok, `Missing capabilities: ${result.missing.join(", ")}`).toBe(true);
  });

  it("Chromium supports the full WebCodecs surface (the fast path)", () => {
    const caps = detectCapabilities();
    expect(caps.audioDecoder).toBe(true);
    expect(caps.videoDecoder).toBe(true);
    expect(caps.audioEncoder).toBe(true);
    expect(caps.videoEncoder).toBe(true);
  });

  it("Chromium supports the File System Access API (nice-to-have)", () => {
    const caps = detectCapabilities();
    expect(caps.fileSystemAccess).toBe(true);
  });
});
