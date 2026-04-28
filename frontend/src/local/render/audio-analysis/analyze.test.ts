import { describe, it, expect } from "vitest";
import { analyzeAudio } from "./analyze";

const SR = 22050;

/** Build a synthetic click-track at the given BPM, lasting `seconds`. Each
 *  click is a 5 ms decaying impulse on top of a low-amp white-noise floor. */
function buildClickTrack(bpm: number, seconds: number): Float32Array {
  const total = Math.round(SR * seconds);
  const beatPeriod = 60 / bpm;
  const beatStride = Math.round(beatPeriod * SR);
  const clickLen = Math.round(0.005 * SR);
  const pcm = new Float32Array(total);
  // White-noise floor (very low amplitude).
  for (let i = 0; i < total; i++) pcm[i] = (Math.random() - 0.5) * 0.01;

  for (let beat = 0; beat * beatStride + clickLen < total; beat++) {
    const start = beat * beatStride;
    for (let k = 0; k < clickLen; k++) {
      const env = Math.exp((-k / clickLen) * 4);
      // Short broadband impulse: sum a couple of sinusoids + noise burst.
      const tone =
        Math.sin((2 * Math.PI * 200 * k) / SR) +
        0.6 * Math.sin((2 * Math.PI * 1500 * k) / SR);
      pcm[start + k] += 0.8 * env * tone;
    }
  }
  return pcm;
}

describe("analyzeAudio — pure pipeline", () => {
  it("populates the basic shape and bands for a normal-length track", () => {
    const pcm = buildClickTrack(120, 8); // 8 seconds, 120 BPM
    const a = analyzeAudio(pcm, SR);
    expect(a.version).toBe(1);
    expect(a.sampleRate).toBe(SR);
    expect(a.duration).toBeCloseTo(8, 1);
    expect(a.bands.bass.length).toBeGreaterThan(0);
    expect(a.bands.bass.length).toBe(a.bands.mids.length);
    expect(a.bands.bass.length).toBe(a.rms.length);
    expect(a.bands.bass.length).toBe(a.onsetStrength.length);
  });

  it("detects 120 BPM ± 2 from a 4-on-the-floor click track", () => {
    const pcm = buildClickTrack(120, 12);
    const a = analyzeAudio(pcm, SR);
    expect(a.tempo).not.toBeNull();
    expect(a.tempo!.bpm).toBeGreaterThan(118);
    expect(a.tempo!.bpm).toBeLessThan(122);
  });

  it("detects 90 BPM ± 2 from a slower click track", () => {
    const pcm = buildClickTrack(90, 14);
    const a = analyzeAudio(pcm, SR);
    expect(a.tempo).not.toBeNull();
    expect(a.tempo!.bpm).toBeGreaterThan(88);
    expect(a.tempo!.bpm).toBeLessThan(92);
  });

  it("emits beats roughly every beat-period (count near duration*bpm/60)", () => {
    const pcm = buildClickTrack(120, 10);
    const a = analyzeAudio(pcm, SR);
    expect(a.beats.length).toBeGreaterThan(15);
    expect(a.beats.length).toBeLessThan(25);
  });

  it("makes downbeats every 4th beat (4/4 fixed)", () => {
    const pcm = buildClickTrack(120, 12);
    const a = analyzeAudio(pcm, SR);
    expect(a.downbeats.length).toBe(Math.ceil(a.beats.length / 4));
    if (a.beats.length >= 5) {
      expect(a.downbeats[0]).toBeCloseTo(a.beats[0], 6);
      expect(a.downbeats[1]).toBeCloseTo(a.beats[4], 6);
    }
  });

  it("finds onsets close to the actual click positions (~0.5 s spacing)", () => {
    const pcm = buildClickTrack(120, 6);
    const a = analyzeAudio(pcm, SR);
    expect(a.onsets.length).toBeGreaterThan(8);
    // Spectral-flux can't see the very first click (it's at the window edge),
    // so onsets[0] corresponds to a later click — but spacing must be ~beat.
    if (a.onsets.length >= 3) {
      const d0 = a.onsets[1] - a.onsets[0];
      const d1 = a.onsets[2] - a.onsets[1];
      expect(d0).toBeGreaterThan(0.4);
      expect(d0).toBeLessThan(0.6);
      expect(d1).toBeGreaterThan(0.4);
      expect(d1).toBeLessThan(0.6);
    }
  });

  it("returns the empty-shape skeleton for too-short audio", () => {
    const pcm = new Float32Array(SR / 50); // ~20 ms — way below 4 frames
    const a = analyzeAudio(pcm, SR);
    expect(a.tempo).toBeNull();
    expect(a.beats.length).toBe(0);
    expect(a.bands.bass.length).toBe(0);
  });
});
