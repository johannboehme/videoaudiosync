/**
 * Unit-Tests für WebGPUBackend in jsdom — ohne echtes GPU-Device.
 * Hier deckt ab:
 *   - init() wirft sauber wenn `navigator.gpu` fehlt (jsdom)
 *   - id ist "webgpu"
 *   - dispose() ist idempotent (safe ohne init)
 *   - warmup() ist no-op
 *
 * Pixel-Parity wird in webgpu-backend.browser.test.ts verifiziert
 * (echtes GPU-Device, Chromium via Playwright).
 */
import { describe, expect, it } from "vitest";
import { WebGPUBackend } from "./webgpu-backend";

function mockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  // jsdom hat kein webgpu — getContext("webgpu") liefert null. Das wird
  // im Backend nach dem requestAdapter-Check geprüft, aber wir kommen
  // vorher schon beim "navigator.gpu missing"-Check raus.
  return canvas;
}

describe("WebGPUBackend (jsdom)", () => {
  it("id is 'webgpu'", () => {
    expect(new WebGPUBackend().id).toBe("webgpu");
  });

  it("init() rejects with BackendError when navigator.gpu missing", async () => {
    const b = new WebGPUBackend();
    await expect(
      b.init(mockCanvas(), { pixelW: 1, pixelH: 1 }),
    ).rejects.toThrow(/navigator\.gpu|adapter|init/i);
  });

  it("warmup() is a no-op (resolves immediately)", async () => {
    const b = new WebGPUBackend();
    await expect(b.warmup()).resolves.toBeUndefined();
  });

  it("dispose() is safe to call without init()", () => {
    const b = new WebGPUBackend();
    expect(() => b.dispose()).not.toThrow();
  });

  it("dispose() is idempotent (safe to call twice)", () => {
    const b = new WebGPUBackend();
    b.dispose();
    expect(() => b.dispose()).not.toThrow();
  });
});
