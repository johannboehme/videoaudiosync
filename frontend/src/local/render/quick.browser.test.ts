import { describe, it, expect } from "vitest";
import { quickRender } from "./quick";
import { decodeAudioToMonoPcm } from "../codec/webcodecs/audio-decode";
import { demuxVideoTrack } from "../codec/webcodecs/demux";

const VIDEO_FIXTURE_URL = "/__test_fixtures__/tone-3s.mp4";

/** Builds a 16-bit PCM WAV from interleaved Float32 samples. */
function makeWav(samples: Float32Array, channels: number, sampleRate: number): Blob {
  const numSamples = samples.length / channels;
  const dataLen = numSamples * channels * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  // RIFF header
  dv.setUint32(0, 0x52494646, false); // "RIFF"
  dv.setUint32(4, 36 + dataLen, true);
  dv.setUint32(8, 0x57415645, false); // "WAVE"
  // fmt chunk
  dv.setUint32(12, 0x666d7420, false); // "fmt "
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true); // PCM
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * channels * 2, true);
  dv.setUint16(32, channels * 2, true);
  dv.setUint16(34, 16, true);
  // data chunk
  dv.setUint32(36, 0x64617461, false); // "data"
  dv.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

function makeSineWav(freqHz: number, durationS: number, sampleRate: number): Blob {
  const n = Math.floor(durationS * sampleRate);
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = 0.5 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate);
  }
  return makeWav(samples, 1, sampleRate);
}

describe("quickRender (real Chromium WebCodecs + mp4-muxer)", () => {
  it("produces an MP4 that has the original video stream and the new audio", async () => {
    const videoBlob = await (await fetch(VIDEO_FIXTURE_URL)).blob();
    // Studio audio: 880 Hz tone for 3 seconds, mono, 48 kHz.
    const studioAudio = makeSineWav(880, 3.0, 48000);

    const result = await quickRender({
      videoFile: videoBlob,
      audioFile: studioAudio,
      offsetMs: 0,
      driftRatio: 1.0,
    });

    expect(result.output.byteLength).toBeGreaterThan(1000);
    expect(result.videoCodec.startsWith("avc1.")).toBe(true);
    expect(result.width).toBe(320);
    expect(result.height).toBe(240);
    expect(result.audioBackend).toBe("webcodecs");

    // The output should still parse as MP4 with the same video properties.
    const reparsed = await demuxVideoTrack(new Blob([result.output as BlobPart]));
    expect(reparsed).not.toBeNull();
    expect(reparsed!.info.width).toBe(320);
    expect(reparsed!.info.height).toBe(240);

    // The audio should now be the studio tone (~880 Hz), not the phone tone (440 Hz).
    const audio = await decodeAudioToMonoPcm(new Blob([result.output as BlobPart]), 22050);
    expect(audio.pcm.length).toBeGreaterThan(22050 * 2.5);
    // Zero-crossing rate of 880 Hz should be ~1760 per second.
    const window = audio.pcm.slice(22050, 22050 * 2);
    let zc = 0;
    for (let i = 1; i < window.length; i++) {
      if (window[i - 1] <= 0 && window[i] > 0) zc++;
    }
    expect(zc).toBeGreaterThan(800);
    expect(zc).toBeLessThan(900);
  }, 60_000);

  it("applies a positive offset so the studio audio starts later in the timeline", async () => {
    const videoBlob = await (await fetch(VIDEO_FIXTURE_URL)).blob();
    const studioAudio = makeSineWav(880, 2.5, 48000);

    const offsetMs = 500;
    const result = await quickRender({
      videoFile: videoBlob,
      audioFile: studioAudio,
      offsetMs,
      driftRatio: 1.0,
    });

    const audio = await decodeAudioToMonoPcm(new Blob([result.output as BlobPart]), 22050);
    // First 500 ms should be near silence (the prepended zero pad).
    const silenceWindow = audio.pcm.slice(0, Math.floor(22050 * 0.45));
    const silenceRms = Math.sqrt(
      silenceWindow.reduce((a, x) => a + x * x, 0) / silenceWindow.length,
    );
    expect(silenceRms).toBeLessThan(0.02);

    // After 500 ms there should be real signal.
    const toneStart = Math.floor(22050 * 0.6);
    const toneWindow = audio.pcm.slice(toneStart, toneStart + 22050);
    const toneRms = Math.sqrt(
      toneWindow.reduce((a, x) => a + x * x, 0) / toneWindow.length,
    );
    expect(toneRms).toBeGreaterThan(0.05);
  }, 60_000);
});
