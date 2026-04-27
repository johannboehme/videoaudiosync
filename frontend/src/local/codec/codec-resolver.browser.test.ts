import { describe, it, expect } from "vitest";
import { decodeAudioToMonoPcm } from "./index";

const FIXTURE_URL = "/__test_fixtures__/tone-3s.mp4";

async function fetchFixture(): Promise<Blob> {
  const r = await fetch(FIXTURE_URL);
  return await r.blob();
}

describe("codec resolver: decodeAudioToMonoPcm (real Chromium)", () => {
  it("default path picks WebCodecs (decodeAudioData) for a standard MP4", async () => {
    const blob = await fetchFixture();
    const result = await decodeAudioToMonoPcm(blob, 22050);
    expect(result.backend).toBe("webcodecs");
    expect(result.sampleRate).toBe(22050);
    expect(result.pcm.length).toBeGreaterThan(22050 * 2.5);
  });

  it(
    "ffmpeg.wasm fallback yields the same audio (within tolerance) when forced",
    async () => {
      const blob = await fetchFixture();
      const a = await decodeAudioToMonoPcm(blob, 22050, {
        forceBackend: "webcodecs",
      });
      const b = await decodeAudioToMonoPcm(blob, 22050, {
        forceBackend: "ffmpeg-wasm",
      });
      expect(b.backend).toBe("ffmpeg-wasm");

      // Both paths should produce roughly the same number of samples
      // (within 100 ms due to differing edge handling).
      const tolSamples = 22050 / 10;
      expect(Math.abs(a.pcm.length - b.pcm.length)).toBeLessThan(tolSamples);

      // RMS sanity: both paths produce non-trivial audio. Exact match is
      // not enforced because WebCodecs and ffmpeg use different mono
      // mix-down strategies (channel averaging vs filter-graph downmix).
      const aRms = rms(a.pcm.slice(22050, 22050 * 2));
      const bRms = rms(b.pcm.slice(22050, 22050 * 2));
      expect(aRms).toBeGreaterThan(0.05);
      expect(bRms).toBeGreaterThan(0.05);

      // Both must report a 440 Hz fundamental (zero-crossing rate ~880/s).
      const aZc = zeroCrossings(a.pcm.slice(22050, 22050 * 2));
      const bZc = zeroCrossings(b.pcm.slice(22050, 22050 * 2));
      expect(aZc).toBeGreaterThan(420);
      expect(aZc).toBeLessThan(460);
      expect(bZc).toBeGreaterThan(420);
      expect(bZc).toBeLessThan(460);
    },
    120_000, // ffmpeg.wasm cold start can be slow
  );
});

function rms(buf: Float32Array): number {
  let s = 0;
  for (const v of buf) s += v * v;
  return Math.sqrt(s / buf.length);
}

function zeroCrossings(buf: Float32Array): number {
  let n = 0;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i - 1] <= 0 && buf[i] > 0) n++;
  }
  return n;
}
