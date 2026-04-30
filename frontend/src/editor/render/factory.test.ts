import { describe, expect, it, vi } from "vitest";
import { createBackend, type BackendCapabilities } from "./factory";
import { WebGPUBackend } from "./webgpu-backend";

/** Mock canvas with a getContext that returns a hand-rolled 2D ctx
 *  (jsdom doesn't ship one). Matches the pattern used in
 *  canvas2d-backend.test.ts. */
function mockCanvas(): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    translate: vi.fn(),
    rotate: vi.fn(),
    scale: vi.fn(),
    createRadialGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: "",
  };
  (canvas as unknown as { getContext: (type: string) => unknown }).getContext = (
    type: string,
  ) => (type === "2d" ? ctx : null);
  return canvas;
}

const CAPS_NEITHER: BackendCapabilities = { webgl2: false, webgpu: false };
const CAPS_WEBGL2: BackendCapabilities = { webgl2: true, webgpu: false };
const CAPS_BOTH: BackendCapabilities = { webgl2: true, webgpu: true };

describe("createBackend factory — fallback ladder", () => {
  it("falls back to Canvas2D when no GPU capability available", async () => {
    const b = await createBackend(mockCanvas(), { pixelW: 1, pixelH: 1 }, CAPS_NEITHER);
    expect(b.id).toBe("canvas2d");
  });

  it("returns Canvas2D when WebGL2 init throws (jsdom — no real WebGL)", async () => {
    // jsdom's canvas.getContext("webgl2") returns null → WebGL2Backend init
    // throws → factory should fall through to Canvas2D.
    const b = await createBackend(mockCanvas(), { pixelW: 1, pixelH: 1 }, CAPS_WEBGL2);
    expect(b.id).toBe("canvas2d");
  });

  it("never tries WebGPU when EXPERIMENTAL_WEBGPU is false (default)", async () => {
    // Spy on WebGPUBackend.init — it must NOT be called even with caps.webgpu.
    const initSpy = vi.spyOn(WebGPUBackend.prototype, "init");
    await createBackend(mockCanvas(), { pixelW: 1, pixelH: 1 }, CAPS_BOTH);
    expect(initSpy).not.toHaveBeenCalled();
    initSpy.mockRestore();
  });

  it("Canvas2DBackend is always reachable as the floor", async () => {
    const b = await createBackend(
      mockCanvas(),
      { pixelW: 100, pixelH: 50 },
      CAPS_NEITHER,
    );
    expect(b.id).toBe("canvas2d");
    b.dispose();
  });
});

describe("WebGPUBackend stub", () => {
  it("init() rejects with BackendError", async () => {
    const b = new WebGPUBackend();
    await expect(b.init(mockCanvas(), { pixelW: 1, pixelH: 1 })).rejects.toThrow(
      /not implemented/,
    );
  });

  it("warmup is a no-op", async () => {
    const b = new WebGPUBackend();
    await expect(b.warmup()).resolves.toBeUndefined();
  });

  it("dispose is safe to call (no init required)", () => {
    const b = new WebGPUBackend();
    expect(() => b.dispose()).not.toThrow();
  });
});
