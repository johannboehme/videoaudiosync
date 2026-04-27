import { describe, it, expect } from "vitest";
import { StreamingVideoEncoder } from "./video-encode";

/**
 * Regression test for the resolution bug:
 * "The provided resolution (1392x1872) has a coded area which exceeds the
 *  maximum coded area supported by the AVC level (3.1) indicated by the
 *  codec string (0x1F)."
 *
 * Caused by hardcoded `avc1.42E01F` (Constrained Baseline @ Level 3.1) in
 * `video-encode.ts`. After the fix, the encoder picks the right level
 * automatically based on resolution + framerate.
 */

async function pushSyntheticFrames(
  enc: StreamingVideoEncoder,
  width: number,
  height: number,
  frameRate: number,
  seconds = 0.4,
): Promise<void> {
  const total = Math.max(2, Math.round(seconds * frameRate));
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("OffscreenCanvas 2d unavailable");
  for (let i = 0; i < total; i++) {
    // Vary the colour so the encoder doesn't trip over identical frames.
    ctx.fillStyle = `rgb(${(i * 13) % 256}, ${(i * 31) % 256}, ${(i * 53) % 256})`;
    ctx.fillRect(0, 0, width, height);
    const frame = new VideoFrame(canvas, {
      timestamp: Math.round((i / frameRate) * 1_000_000),
      duration: Math.round((1 / frameRate) * 1_000_000),
    });
    enc.pushFrame(frame, { keyFrame: i === 0 });
    frame.close();
  }
}

describe("StreamingVideoEncoder — resolution → AVC level", () => {
  it(
    "encodes 1392×1872 (the user's failing resolution) without 'coded area exceeds maximum' errors",
    async () => {
      const fps = 30;
      const enc = new StreamingVideoEncoder({
        width: 1392,
        height: 1872,
        frameRate: fps,
      });
      await pushSyntheticFrames(enc, 1392, 1872, fps);
      const result = await enc.finish();

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.width).toBe(1392);
      expect(result.height).toBe(1872);
      // Codec must be Constrained Baseline at level >= 5.0 (0x32) for this size.
      expect(result.codec).toMatch(/^avc1\.42E0(32|33|34|3C|3D|3E)$/);
    },
    60_000,
  );

  it(
    "still works for the standard 1280×720 case",
    async () => {
      const fps = 30;
      const enc = new StreamingVideoEncoder({
        width: 1280,
        height: 720,
        frameRate: fps,
      });
      await pushSyntheticFrames(enc, 1280, 720, fps);
      const result = await enc.finish();

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.codec).toBe("avc1.42E01F");
    },
    60_000,
  );

  it(
    "encodes a 1080p frame (real-world phone capture) without errors",
    async () => {
      const fps = 30;
      const enc = new StreamingVideoEncoder({
        width: 1920,
        height: 1080,
        frameRate: fps,
      });
      await pushSyntheticFrames(enc, 1920, 1080, fps);
      const result = await enc.finish();

      expect(result.chunks.length).toBeGreaterThan(0);
      expect(result.codec).toMatch(/^avc1\.42E0(28|29|2A|32|33|34)$/);
    },
    60_000,
  );
});
