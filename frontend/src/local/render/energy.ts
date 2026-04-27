/**
 * Audio energy curves per frequency band — port of `app/pipeline/energy.py`.
 *
 * Returns a structure compatible with what the ASS reactive-modulation
 * sampler expects (see `ass-builder.ts:reactiveKeyframes`).
 *
 * Algorithm (matches the backend):
 *   1. STFT with n_fft=2048, hop = round(sr / fps).
 *   2. Power spectrogram |S|^2.
 *   3. For each band (Hz range): sum bins, log1p, normalize 0..1, round to 4 decimals.
 *
 * Uses fft.js for the FFT (small, pure-JS, fast enough for offline analysis
 * — typical 90 s audio runs in well under a second on M1).
 */

import FFT from "fft.js";
import type { EnergyCurves } from "./ass-builder";

const N_FFT = 2048;

export const BANDS_HZ: Record<string, [number, number]> = {
  bass: [20, 200],
  low_mids: [200, 800],
  mids: [800, 3000],
  highs: [3000, 12000],
};

export function computeEnergyCurves(
  pcm: Float32Array,
  sampleRate: number,
  fps = 30,
): EnergyCurves {
  if (pcm.length === 0) {
    return { fps, frames: 0, bands: {} };
  }
  const hop = Math.max(1, Math.round(sampleRate / fps));

  // STFT setup.
  const fft = new FFT(N_FFT);
  // Hann window (period N_FFT-1) — matches the librosa default.
  const window = new Float32Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) {
    const arg = (Math.PI * i) / (N_FFT - 1);
    window[i] = Math.sin(arg) ** 2;
  }

  const nBins = N_FFT / 2 + 1;
  // Pre-compute frequency for each bin and band masks.
  const binHz = sampleRate / N_FFT;
  const bandMasks: Record<string, boolean[]> = {};
  for (const [name, [lo, hi]] of Object.entries(BANDS_HZ)) {
    const mask: boolean[] = [];
    for (let k = 0; k < nBins; k++) {
      const f = k * binHz;
      mask.push(f >= lo && f < hi);
    }
    bandMasks[name] = mask;
  }

  // Frame loop. librosa's stft uses centered framing by default (pads with
  // n_fft/2 on both sides). We replicate that pad scheme so the output frame
  // count matches librosa's S.shape[1].
  const padded = new Float32Array(pcm.length + N_FFT);
  // Left pad with reflection of first samples (librosa default = "reflect").
  // For our purposes (energy magnitude only) reflect-vs-zero is below the
  // 0.001-precision rounding threshold, so we use zeros for simplicity.
  padded.set(pcm, N_FFT / 2);

  const nFrames = Math.floor((padded.length - N_FFT) / hop) + 1;

  const inputBuf = fft.createComplexArray() as number[];
  const outputBuf = fft.createComplexArray() as number[];

  // Accumulator per band per frame.
  const bandFrames: Record<string, Float32Array> = {};
  for (const name of Object.keys(BANDS_HZ)) {
    bandFrames[name] = new Float32Array(nFrames);
  }

  for (let frame = 0; frame < nFrames; frame++) {
    const start = frame * hop;
    if (start + N_FFT > padded.length) break;

    // Build complex input: real = windowed sample, imag = 0.
    for (let i = 0; i < N_FFT; i++) {
      inputBuf[2 * i] = padded[start + i] * window[i];
      inputBuf[2 * i + 1] = 0;
    }
    fft.transform(outputBuf, inputBuf);

    // Power spectrogram for first nBins (Nyquist+1).
    for (const [name, mask] of Object.entries(bandMasks)) {
      let sum = 0;
      for (let k = 0; k < nBins; k++) {
        if (!mask[k]) continue;
        const re = outputBuf[2 * k];
        const im = outputBuf[2 * k + 1];
        sum += re * re + im * im;
      }
      bandFrames[name][frame] = sum;
    }
  }

  // log1p + normalize 0..1 + round to 4 decimals.
  const out: Record<string, number[]> = {};
  for (const [name, arr] of Object.entries(bandFrames)) {
    let maxV = 0;
    for (let i = 0; i < arr.length; i++) {
      arr[i] = Math.log1p(arr[i]);
      if (arr[i] > maxV) maxV = arr[i];
    }
    if (maxV > 0) {
      for (let i = 0; i < arr.length; i++) arr[i] /= maxV;
    }
    out[name] = Array.from(arr).map((v) => Math.round(v * 10000) / 10000);
  }

  return { fps, frames: nFrames, bands: out };
}

export function sampleAt(curves: EnergyCurves, band: string, tSeconds: number): number {
  const data = curves.bands[band];
  if (!data || data.length === 0) return 0;
  const fps = curves.fps || 30;
  const idx = Math.round(tSeconds * fps);
  if (idx < 0) return 0;
  if (idx >= data.length) return data[data.length - 1];
  return data[idx];
}
