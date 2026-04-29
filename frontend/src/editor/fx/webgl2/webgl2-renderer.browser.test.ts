import { describe, it, expect } from "vitest";
import { WebGL2FxRenderer } from "./webgl2-renderer";
import type { PunchFx } from "../types";

const fx = (id: string, inS: number, outS: number): PunchFx => ({
  id,
  kind: "vignette",
  inS,
  outS,
});

/** Read out a single pixel as RGBA tuple from the canvas (after a render).
 *  Uses gl.readPixels on the active framebuffer — runs in real Chromium. */
function readPixel(
  canvas: HTMLCanvasElement,
  x: number,
  y: number,
): [number, number, number, number] {
  const gl = canvas.getContext("webgl2");
  if (!gl) throw new Error("readPixel: no webgl2 context");
  const out = new Uint8Array(4);
  gl.readPixels(
    x,
    canvas.height - 1 - y, // GL coords are bottom-up
    1,
    1,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    out,
  );
  return [out[0], out[1], out[2], out[3]];
}

describe("WebGL2FxRenderer (real browser)", () => {
  it("instantiates and reports backend", () => {
    const canvas = document.createElement("canvas");
    const r = new WebGL2FxRenderer(canvas);
    expect(r.backend).toBe("webgl2");
    r.destroy();
  });

  it("clears to fully transparent when no fx is active", () => {
    const canvas = document.createElement("canvas");
    const r = new WebGL2FxRenderer(canvas);
    r.resize(64, 64, 1);
    r.render(0, []);
    const [, , , a] = readPixel(canvas, 32, 32);
    expect(a).toBe(0);
    r.destroy();
  });

  it("vignette darkens corners more than centre (alpha increases outward)", () => {
    const canvas = document.createElement("canvas");
    const r = new WebGL2FxRenderer(canvas);
    r.resize(64, 64, 1);
    r.render(0.5, [fx("a", 0, 1)]);
    const centre = readPixel(canvas, 32, 32);
    const corner = readPixel(canvas, 1, 1);
    // Centre ≈ transparent (no falloff yet), corner = dark with high alpha.
    expect(centre[3]).toBeLessThan(corner[3]);
    expect(corner[3]).toBeGreaterThan(50); // visibly dark
    r.destroy();
  });
});
