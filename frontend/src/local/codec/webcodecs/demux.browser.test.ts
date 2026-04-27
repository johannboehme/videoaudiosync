import { describe, it, expect } from "vitest";
import { demuxVideoTrack } from "./demux";

const FIXTURE_URL = "/__test_fixtures__/tone-3s.mp4";

async function fetchFixture(): Promise<Blob> {
  const r = await fetch(FIXTURE_URL);
  return await r.blob();
}

describe("demuxVideoTrack (real Chromium + mp4box)", () => {
  it("parses the fixture and reports width/height/codec", async () => {
    const blob = await fetchFixture();
    const result = await demuxVideoTrack(blob);
    expect(result).not.toBeNull();
    expect(result!.info.width).toBe(320);
    expect(result!.info.height).toBe(240);
    expect(result!.info.codec.startsWith("avc1.")).toBe(true);
    expect(result!.info.durationS).toBeCloseTo(3.0, 1);
    expect(result!.info.description.length).toBeGreaterThan(8); // avcC payload, non-trivial
  });

  it("returns one chunk per video sample, all bytes non-empty", async () => {
    const blob = await fetchFixture();
    const result = await demuxVideoTrack(blob);
    expect(result).not.toBeNull();
    // 3s @ 30fps = 90 frames, ±1.
    expect(result!.chunks.length).toBeGreaterThanOrEqual(85);
    expect(result!.chunks.length).toBeLessThanOrEqual(95);
    expect(result!.chunks.every((c) => c.data.length > 0)).toBe(true);
    // First chunk is a key frame.
    expect(result!.chunks[0].isKey).toBe(true);
  });

  it("video chunks decode successfully via the browser's VideoDecoder", async () => {
    const blob = await fetchFixture();
    const result = await demuxVideoTrack(blob);
    expect(result).not.toBeNull();

    let decoded = 0;
    let errored: Error | null = null;
    const decoder = new VideoDecoder({
      output: () => {
        decoded++;
      },
      error: (e) => {
        errored = e instanceof Error ? e : new Error(String(e));
      },
    });
    decoder.configure({
      codec: result!.info.codec,
      codedWidth: result!.info.width,
      codedHeight: result!.info.height,
      description: result!.info.description,
    });
    for (const c of result!.chunks) {
      decoder.decode(
        new EncodedVideoChunk({
          type: c.isKey ? "key" : "delta",
          timestamp: c.timestampUs,
          duration: c.durationUs,
          data: c.data,
        }),
      );
    }
    await decoder.flush();
    decoder.close();

    expect(errored).toBeNull();
    // Should match (or be close to) the chunk count.
    expect(decoded).toBeGreaterThan(0);
    expect(decoded).toBeGreaterThanOrEqual(result!.chunks.length - 2);
  });
});
