import { describe, it, expect } from "vitest";
import { decodeAudioToMonoPcm } from "./audio-decode";

const FIXTURE_URL = "/__test_fixtures__/tone-3s.mp4";

async function fetchFixture(): Promise<File> {
  const res = await fetch(FIXTURE_URL);
  if (!res.ok) throw new Error(`Fixture missing: ${FIXTURE_URL} (status ${res.status})`);
  const blob = await res.blob();
  return new File([blob], "tone-3s.mp4", { type: "video/mp4" });
}

describe("decodeAudioToMonoPcm (real Chromium WebCodecs)", () => {
  it("decodes the fixture MP4 into mono PCM at the requested sample rate", async () => {
    const file = await fetchFixture();
    const result = await decodeAudioToMonoPcm(file, 22050);

    expect(result.sampleRate).toBe(22050);
    expect(result.backend).toBe("webcodecs");

    // 3 seconds at 22050 Hz = ~66150 samples (some encoders pad slightly).
    // We want this within 100 ms tolerance.
    const expected = 22050 * 3;
    expect(result.pcm.length).toBeGreaterThan(expected - 22050 / 10);
    expect(result.pcm.length).toBeLessThan(expected + 22050 / 5);
  });

  it("the decoded audio is a 440 Hz sine wave (energy concentrated near 440 Hz)", async () => {
    const file = await fetchFixture();
    const { pcm, sampleRate } = await decodeAudioToMonoPcm(file, 22050);

    // Mid second (avoid attack/release artifacts).
    const start = sampleRate * 1;
    const window = pcm.slice(start, start + sampleRate);
    expect(window.length).toBe(sampleRate);

    // RMS should be > 0 (real audio).
    const rms = Math.sqrt(window.reduce((a, x) => a + x * x, 0) / window.length);
    expect(rms).toBeGreaterThan(0.05);

    // Zero-crossing rate of a 440 Hz tone in 1 second = ~880.
    let zc = 0;
    for (let i = 1; i < window.length; i++) {
      if (window[i - 1] <= 0 && window[i] > 0) zc++;
    }
    // tolerance because of resampling and encoder bias
    expect(zc).toBeGreaterThan(420);
    expect(zc).toBeLessThan(460);
  });

  it("decodes the fixture at 48000 Hz when requested (no resample)", async () => {
    const file = await fetchFixture();
    const result = await decodeAudioToMonoPcm(file, 48000);
    expect(result.sampleRate).toBe(48000);
    const expected = 48000 * 3;
    expect(result.pcm.length).toBeGreaterThan(expected - 48000 / 10);
    expect(result.pcm.length).toBeLessThan(expected + 48000 / 5);
  });
});
