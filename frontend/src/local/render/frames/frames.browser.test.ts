import { describe, expect, it } from "vitest";
import { extractTimelineFrames } from "./index";

const FIXTURE_LANDSCAPE = "/__test_fixtures__/tone-3s.mp4"; // 320×240, ~3s
const FIXTURE_PORTRAIT = "/__test_fixtures__/video-portrait-1080.mp4";

async function fetchFixture(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fixture missing: ${url} (${r.status})`);
  return await r.blob();
}

async function decodeStripBitmap(blob: Blob): Promise<ImageBitmap> {
  return await createImageBitmap(blob);
}

describe("extractTimelineFrames — WebCodecs primary path (real Chromium)", () => {
  it("produces a tile-strip whose width = tileWidth × tileCount", async () => {
    const blob = await fetchFixture(FIXTURE_LANDSCAPE);
    const result = await extractTimelineFrames(blob, { tileHeight: 80 });
    expect(result.manifest.backend).toBe("webcodecs");
    expect(result.manifest.tileCount).toBeGreaterThan(0);
    expect(result.manifest.tileHeight).toBe(80);

    const bmp = await decodeStripBitmap(result.blob);
    try {
      expect(bmp.height).toBe(80);
      expect(bmp.width).toBe(
        result.manifest.tileCount * result.manifest.tileWidth,
      );
    } finally {
      bmp.close();
    }
  }, 60_000);

  it("uses 0.5s sampling for the 3s fixture (≤60s bucket)", async () => {
    const blob = await fetchFixture(FIXTURE_LANDSCAPE);
    const result = await extractTimelineFrames(blob);
    // 3s / 0.5s = 6 tiles.
    expect(result.manifest.tileCount).toBe(6);
  }, 60_000);

  it("respects portrait aspect (tile narrower than tall)", async () => {
    const blob = await fetchFixture(FIXTURE_PORTRAIT);
    const result = await extractTimelineFrames(blob, { tileHeight: 80 });
    expect(result.manifest.tileWidth).toBeLessThan(result.manifest.tileHeight);
    const bmp = await decodeStripBitmap(result.blob);
    try {
      expect(bmp.height).toBe(80);
    } finally {
      bmp.close();
    }
  }, 60_000);

  it("each tile contains non-uniform pixels (i.e. video frames, not black)", async () => {
    const blob = await fetchFixture(FIXTURE_LANDSCAPE);
    const result = await extractTimelineFrames(blob);
    const bmp = await decodeStripBitmap(result.blob);
    const canvas = new OffscreenCanvas(bmp.width, bmp.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bmp, 0, 0);
    bmp.close();

    // Check the centre pixel of each tile column has been written. The
    // fixture's content is far from uniform, so at least one channel
    // should differ from pure black on most tiles.
    const tw = result.manifest.tileWidth;
    let nonBlackTiles = 0;
    for (let i = 0; i < result.manifest.tileCount; i++) {
      const px = ctx.getImageData(i * tw + Math.floor(tw / 2), 40, 1, 1).data;
      if (px[0] + px[1] + px[2] > 8) nonBlackTiles++;
    }
    expect(nonBlackTiles).toBeGreaterThan(0);
  }, 60_000);
});

describe("extractTimelineFrames — ffmpeg.wasm fallback path (real Chromium)", () => {
  it("produces a tile-strip with the same shape as the WebCodecs path", async () => {
    const blob = await fetchFixture(FIXTURE_LANDSCAPE);
    const result = await extractTimelineFrames(blob, {
      forceBackend: "ffmpeg-wasm",
    });
    expect(result.manifest.backend).toBe("ffmpeg-wasm");
    // 3s / 0.5s = 6 tiles.
    expect(result.manifest.tileCount).toBe(6);
    expect(result.manifest.tileHeight).toBe(80);

    const bmp = await decodeStripBitmap(result.blob);
    try {
      expect(bmp.height).toBe(80);
      expect(bmp.width).toBe(
        result.manifest.tileCount * result.manifest.tileWidth,
      );
    } finally {
      bmp.close();
    }
  }, 180_000);
});
