/**
 * Pure audio-analysis pipeline. No DOM, no Worker — drives off a Float32Array
 * mono PCM buffer at a known sample rate and returns a fully-populated
 * AudioAnalysis. Deterministic; tested with canned signals.
 *
 * Pipeline:
 *   PCM → STFT (n_fft=2048, hop=sr/30, Hann) → mag spectrogram
 *       → 4-band log-spaced energy
 *       → spectral-flux onset envelope + peak-pick
 *       → per-band peak-picks
 *       → RMS (time-domain, hop-aligned)
 *       → autocorrelation tempo (with octave voting) — coarse seed only
 *       → DP beat-tracking (Ellis 2007 — cost = -onset + α·log²(period/Δ))
 *       → least-squares refit of (period, phase) through detected beats:
 *         the autocorrelation peak is quantized (~8 BPM at 120 BPM, partly
 *         mitigated by parabolic refinement) and the autocorrelation phase
 *         only sees the first beat-period — so for any track that doesn't
 *         start on the downbeat, the refit is what makes the snap-grid
 *         actually line up with the music
 *       → downbeats every 4th beat (4/4 fixed in V1)
 *
 * Frame-to-time convention: every event time uses the window-CENTER of its
 * STFT frame, i.e. `(i*hop + N_FFT/2) / sr`. Reporting the window-start
 * (`i*hop / sr`) would put every onset/beat ~46 ms early at sr=22050.
 */
import FFT from "fft.js";
import type { AudioAnalysis, BandSet, Tempo } from "./types";

const N_FFT = 2048;
const TARGET_FRAMES_PER_SEC = 30;

// 4-band cutoff frequencies in Hz (geometric-ish coverage of musical content).
const BAND_LIMITS = {
  bass: [20, 200],
  lowMids: [200, 800],
  mids: [800, 3000],
  highs: [3000, 12000],
} as const;

// Tempo search range (BPM).
const MIN_BPM = 60;
const MAX_BPM = 200;

// Beat-tracking weight on the period prior (higher = more rigid tempo).
const BEAT_PRIOR_ALPHA = 100;

export interface AnalyzeOptions {
  /** Override frames-per-second target (default 30). Mostly for tests. */
  framesPerSec?: number;
}

export function analyzeAudio(
  pcm: Float32Array,
  sampleRate: number,
  opts: AnalyzeOptions = {},
): AudioAnalysis {
  const fps = opts.framesPerSec ?? TARGET_FRAMES_PER_SEC;
  const hopSize = Math.max(1, Math.round(sampleRate / fps));
  const framesPerSec = sampleRate / hopSize;
  const totalFrames = Math.max(0, Math.floor((pcm.length - N_FFT) / hopSize) + 1);
  const duration = pcm.length / sampleRate;

  if (totalFrames < 4) {
    // Audio too short for meaningful analysis. Return empty-but-shaped object.
    return emptyAnalysis(sampleRate, duration, hopSize, framesPerSec);
  }

  // Frame i represents the STFT window starting at sample i*hop. We report
  // its time as the window CENTER so an onset that lights up frame i is
  // dated where the energy actually is, not at the leading edge of the
  // analysis window. Using window-start would bias every event ~N_FFT/(2·sr)
  // earlier than truth (~46 ms at sr=22050, N_FFT=2048).
  const halfWinS = N_FFT / (2 * sampleRate);
  const frameToSec = (i: number): number => i / framesPerSec + halfWinS;

  // STFT magnitude spectrogram (totalFrames × (N_FFT/2 + 1))
  const mag = stftMagnitude(pcm, N_FFT, hopSize, totalFrames);

  // Per-band energy time-series.
  const bands = bandEnergies(mag, sampleRate, N_FFT);

  // RMS (time-domain).
  const rms = computeRms(pcm, hopSize, totalFrames, N_FFT);

  // Spectral-flux onset envelope (sum of positive frame-to-frame magnitude
  // differences across all bins, log-compressed to tame loud bursts).
  const onsetStrength = spectralFlux(mag);

  // Peak-pick onsets on the global flux + per band.
  const onsets = pickOnsetFrames(onsetStrength, framesPerSec).map(frameToSec);
  const onsetsByBand: BandSet = {
    bass: pickOnsetFrames(diffPositive(bands.bass), framesPerSec).map(frameToSec),
    lowMids: pickOnsetFrames(diffPositive(bands.lowMids), framesPerSec).map(frameToSec),
    mids: pickOnsetFrames(diffPositive(bands.mids), framesPerSec).map(frameToSec),
    highs: pickOnsetFrames(diffPositive(bands.highs), framesPerSec).map(frameToSec),
  };

  // Coarse tempo seed via onset-strength autocorrelation. The phase it
  // returns is unreliable for tracks that don't start on the downbeat —
  // we replace it via the regression refit below, but the autocorrelation
  // peak is what gets the DP beat-tracker into the right octave.
  const seedTempo = detectTempo(onsetStrength, framesPerSec);

  // Beat-tracking via DP over the onset envelope, given the tempo.
  const beatFrames = seedTempo
    ? trackBeatFrames(onsetStrength, framesPerSec, seedTempo)
    : [];
  const beats = beatFrames.map(frameToSec);

  // Regression refit: solve (period, phase) such that beats[k] ≈ phase + k·period
  // by least squares. Averaging across many beats gives sub-frame precision
  // and — crucially — recovers the true phase from the actual beat positions
  // instead of the autocorrelation's first-period-only search.
  const tempo = seedTempo && beats.length >= 2
    ? refineTempoFromBeats(beats, seedTempo)
    : seedTempo;

  const downbeats = beats.filter((_, i) => i % 4 === 0);

  return {
    version: 1,
    sampleRate,
    duration,
    hopSize,
    framesPerSec,
    bands,
    rms,
    onsetStrength,
    onsets,
    onsetsByBand,
    beats,
    downbeats,
    tempo,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// STFT
// ────────────────────────────────────────────────────────────────────────────

function stftMagnitude(
  pcm: Float32Array,
  nFft: number,
  hop: number,
  totalFrames: number,
): Float32Array[] {
  const fft = new FFT(nFft);
  const win = hannWindow(nFft);
  const winnedFrame = new Array<number>(nFft);
  const out = fft.createComplexArray() as number[];
  const numBins = nFft / 2 + 1;
  const frames: Float32Array[] = new Array(totalFrames);

  for (let i = 0; i < totalFrames; i++) {
    const start = i * hop;
    for (let j = 0; j < nFft; j++) {
      winnedFrame[j] = pcm[start + j] * win[j];
    }
    fft.realTransform(out, winnedFrame);
    // realTransform fills indices 0 .. nFft-1 of the interleaved complex array
    // with the unique half of the spectrum (bins 0 .. nFft/2-1, plus Nyquist
    // at index nFft (re only)). We compute magnitudes for bins 0..nFft/2.
    const m = new Float32Array(numBins);
    for (let k = 0; k < nFft / 2; k++) {
      const re = out[2 * k];
      const im = out[2 * k + 1];
      m[k] = Math.sqrt(re * re + im * im);
    }
    // Nyquist bin (purely real, stored at index nFft of the layout).
    const nyqRe = out[nFft] ?? 0;
    m[nFft / 2] = Math.abs(nyqRe);
    frames[i] = m;
  }
  return frames;
}

function hannWindow(n: number): Float32Array {
  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    w[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
  }
  return w;
}

// ────────────────────────────────────────────────────────────────────────────
// Band energies
// ────────────────────────────────────────────────────────────────────────────

function bandEnergies(
  mag: Float32Array[],
  sampleRate: number,
  nFft: number,
): BandSet {
  const numBins = nFft / 2 + 1;
  const binToHz = sampleRate / nFft;
  const ranges = (Object.keys(BAND_LIMITS) as Array<keyof typeof BAND_LIMITS>).map(
    (k) => {
      const [lo, hi] = BAND_LIMITS[k];
      const loBin = Math.max(1, Math.floor(lo / binToHz));
      const hiBin = Math.min(numBins - 1, Math.ceil(hi / binToHz));
      return { key: k, loBin, hiBin };
    },
  );

  const result: BandSet = {
    bass: new Array(mag.length),
    lowMids: new Array(mag.length),
    mids: new Array(mag.length),
    highs: new Array(mag.length),
  };

  for (let f = 0; f < mag.length; f++) {
    for (const { key, loBin, hiBin } of ranges) {
      let acc = 0;
      const m = mag[f];
      for (let k = loBin; k <= hiBin; k++) acc += m[k] * m[k];
      result[key][f] = Math.sqrt(acc / Math.max(1, hiBin - loBin + 1));
    }
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────
// RMS
// ────────────────────────────────────────────────────────────────────────────

function computeRms(
  pcm: Float32Array,
  hop: number,
  totalFrames: number,
  windowLen: number,
): number[] {
  const rms = new Array<number>(totalFrames);
  for (let i = 0; i < totalFrames; i++) {
    let acc = 0;
    const start = i * hop;
    for (let j = 0; j < windowLen; j++) {
      const v = pcm[start + j];
      acc += v * v;
    }
    rms[i] = Math.sqrt(acc / windowLen);
  }
  return rms;
}

// ────────────────────────────────────────────────────────────────────────────
// Spectral-flux onset envelope
// ────────────────────────────────────────────────────────────────────────────

function spectralFlux(mag: Float32Array[]): number[] {
  const out = new Array<number>(mag.length).fill(0);
  if (mag.length < 2) return out;
  const numBins = mag[0].length;
  // Log-compress before differencing so transients (|ΔlogE|) dominate.
  let prev = logCompress(mag[0]);
  for (let f = 1; f < mag.length; f++) {
    const cur = logCompress(mag[f]);
    let acc = 0;
    for (let k = 0; k < numBins; k++) {
      const d = cur[k] - prev[k];
      if (d > 0) acc += d;
    }
    out[f] = acc;
    prev = cur;
  }
  // Normalize 0..1 (max).
  let maxV = 0;
  for (const v of out) if (v > maxV) maxV = v;
  if (maxV > 0) {
    for (let i = 0; i < out.length; i++) out[i] /= maxV;
  }
  return out;
}

function logCompress(m: Float32Array): Float32Array {
  const out = new Float32Array(m.length);
  for (let i = 0; i < m.length; i++) out[i] = Math.log1p(m[i] * 1000);
  return out;
}

function diffPositive(arr: number[]): number[] {
  const out = new Array<number>(arr.length).fill(0);
  for (let i = 1; i < arr.length; i++) {
    const d = arr[i] - arr[i - 1];
    out[i] = d > 0 ? d : 0;
  }
  let maxV = 0;
  for (const v of out) if (v > maxV) maxV = v;
  if (maxV > 0) for (let i = 0; i < out.length; i++) out[i] /= maxV;
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Peak-picking
// ────────────────────────────────────────────────────────────────────────────

function pickOnsetFrames(strength: number[], framesPerSec: number): number[] {
  if (strength.length < 4) return [];
  // Min-distance ≈ 50 ms; threshold = max(absThr, mean+std).
  const minDist = Math.max(1, Math.round(0.05 * framesPerSec));
  let mean = 0;
  for (const v of strength) mean += v;
  mean /= strength.length;
  let varAcc = 0;
  for (const v of strength) varAcc += (v - mean) ** 2;
  const std = Math.sqrt(varAcc / strength.length);
  const thr = Math.max(0.1, mean + 0.5 * std);

  const peaks: number[] = [];
  for (let i = 1; i < strength.length - 1; i++) {
    const v = strength[i];
    if (v < thr) continue;
    if (v <= strength[i - 1] || v <= strength[i + 1]) continue;
    if (peaks.length > 0 && i - peaks[peaks.length - 1] < minDist) {
      // Replace previous if this peak is stronger.
      if (v > strength[peaks[peaks.length - 1]]) {
        peaks[peaks.length - 1] = i;
      }
      continue;
    }
    peaks.push(i);
  }
  return peaks;
}

// ────────────────────────────────────────────────────────────────────────────
// Tempo via autocorrelation
// ────────────────────────────────────────────────────────────────────────────

function detectTempo(strength: number[], framesPerSec: number): Tempo | null {
  if (strength.length < framesPerSec * 2) return null;

  const minLag = Math.max(1, Math.floor((60 / MAX_BPM) * framesPerSec));
  const maxLag = Math.min(
    strength.length - 1,
    Math.ceil((60 / MIN_BPM) * framesPerSec),
  );
  if (maxLag <= minLag) return null;

  // Demean for cleaner autocorrelation.
  let mean = 0;
  for (const v of strength) mean += v;
  mean /= strength.length;
  const demean = strength.map((v) => v - mean);

  const ac = new Array<number>(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let acc = 0;
    const lim = strength.length - lag;
    for (let i = 0; i < lim; i++) acc += demean[i] * demean[i + lag];
    ac[lag] = acc / Math.max(1, lim);
  }

  // Octave voting: combine ac[lag] with ac[2*lag] and ac[lag/2] (downscaled)
  // to bias toward the perceptual tempo and avoid tempo-half/double errors.
  const voted = new Array<number>(maxLag + 1).fill(0);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let v = ac[lag];
    if (2 * lag <= maxLag) v += 0.5 * ac[2 * lag];
    if (lag % 2 === 0) v += 0.3 * ac[lag / 2];
    voted[lag] = v;
  }

  // Pick the peak.
  let bestLag = minLag;
  let bestVal = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (voted[lag] > bestVal) {
      bestVal = voted[lag];
      bestLag = lag;
    }
  }
  if (bestVal <= 0) return null;

  // Confidence: peak height vs second-best peak (≥ 30 BPM apart).
  const minSepFrames = Math.max(1, Math.round((60 / 30) * framesPerSec * 0));
  let runnerUp = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (Math.abs(lag - bestLag) <= 2 + minSepFrames) continue;
    if (voted[lag] > runnerUp) runnerUp = voted[lag];
  }
  const confidence = runnerUp > 0 ? Math.min(1, 1 - runnerUp / bestVal) : 0.5;

  // Refine by parabolic interpolation around the peak.
  const refinedLag = parabolicRefine(voted, bestLag);
  const periodS = refinedLag / framesPerSec;
  const bpm = 60 / periodS;

  // Phase: index of the strongest onset in the first beat-period.
  const firstWin = Math.round(refinedLag);
  let phaseIdx = 0;
  let phaseVal = -Infinity;
  for (let i = 0; i < Math.min(firstWin, strength.length); i++) {
    if (strength[i] > phaseVal) {
      phaseVal = strength[i];
      phaseIdx = i;
    }
  }
  const phase = phaseIdx / framesPerSec;

  return { bpm, confidence, phase };
}

function parabolicRefine(arr: number[], i: number): number {
  if (i <= 0 || i >= arr.length - 1) return i;
  const ym1 = arr[i - 1];
  const y0 = arr[i];
  const yp1 = arr[i + 1];
  const denom = ym1 - 2 * y0 + yp1;
  if (denom === 0) return i;
  const offset = (0.5 * (ym1 - yp1)) / denom;
  return i + offset;
}

// ────────────────────────────────────────────────────────────────────────────
// Beat-tracking (Ellis 2007 simplified)
// ────────────────────────────────────────────────────────────────────────────

function trackBeatFrames(
  strength: number[],
  framesPerSec: number,
  tempo: Tempo,
): number[] {
  const periodFrames = (60 / tempo.bpm) * framesPerSec;
  const localScore = strength.slice();

  // DP: at each frame i, compute the best cumulative score reaching i,
  // assuming the previous beat is approximately periodFrames ago.
  const cum = new Array<number>(strength.length).fill(-Infinity);
  const back = new Array<number>(strength.length).fill(-1);
  const startWindow = Math.max(1, Math.round(2 * periodFrames));

  for (let i = 0; i < strength.length; i++) {
    if (i < startWindow) {
      cum[i] = localScore[i];
      back[i] = -1;
      continue;
    }
    // Search a window around (i - periodFrames) for the best previous beat.
    const center = Math.round(periodFrames);
    const windowHalf = Math.max(2, Math.round(periodFrames * 0.25));
    let bestCum = -Infinity;
    let bestPrev = -1;
    for (let dt = center - windowHalf; dt <= center + windowHalf; dt++) {
      const p = i - dt;
      if (p < 0) continue;
      // Cost: log²(period_actual / period_target) — Ellis-style.
      const ratio = dt / periodFrames;
      const cost = Math.log(ratio) ** 2;
      const candidate = cum[p] - BEAT_PRIOR_ALPHA * cost;
      if (candidate > bestCum) {
        bestCum = candidate;
        bestPrev = p;
      }
    }
    cum[i] = localScore[i] + (bestCum === -Infinity ? 0 : bestCum);
    back[i] = bestPrev;
  }

  // Find best ending frame in the last beat-window of the track.
  const tailStart = Math.max(0, strength.length - Math.ceil(periodFrames));
  let endIdx = -1;
  let endVal = -Infinity;
  for (let i = tailStart; i < strength.length; i++) {
    if (cum[i] > endVal) {
      endVal = cum[i];
      endIdx = i;
    }
  }
  if (endIdx < 0) return [];

  // Backtrack.
  const beatsRev: number[] = [];
  let cur = endIdx;
  while (cur >= 0) {
    beatsRev.push(cur);
    cur = back[cur];
  }
  beatsRev.reverse();
  return beatsRev;
}

// ────────────────────────────────────────────────────────────────────────────
// Tempo refinement via least-squares regression on detected beats.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Fit `beats[k] ≈ phase + k·period` by least squares so the BPM (and the
 * grid anchor that snap targets are drawn from) reflects the *actual* beat
 * positions rather than an autocorrelation peak quantized to one frame.
 *
 * For tracks with intro silence the autocorrelation phase is wrong by up
 * to a beat-period; the regression intercept lands on the first real
 * beat. For BPM the autocorrelation peak has ~0.1-frame precision after
 * parabolic refinement, which compounds to hundreds of ms of grid drift
 * across a few minutes — averaging across N beats gives O(1/√N) precision
 * and effectively eliminates the drift.
 */
function refineTempoFromBeats(beats: number[], seed: Tempo): Tempo {
  if (beats.length < 2) return seed;
  const n = beats.length;
  let sumK = 0;
  let sumK2 = 0;
  let sumT = 0;
  let sumKT = 0;
  for (let k = 0; k < n; k++) {
    const t = beats[k];
    sumK += k;
    sumK2 += k * k;
    sumT += t;
    sumKT += k * t;
  }
  const denom = n * sumK2 - sumK * sumK;
  if (denom === 0) return seed;
  const period = (n * sumKT - sumK * sumT) / denom;
  if (!isFinite(period) || period <= 0) return seed;
  const phase = (sumT - period * sumK) / n;
  const bpm = 60 / period;

  // Sanity check: the refit must stay inside the search window of the
  // autocorrelation (60..200 BPM). If it bolts somewhere weird, keep the
  // seed BPM but still adopt the regression intercept as phase.
  if (bpm < 30 || bpm > 240) {
    return { ...seed, phase };
  }

  return {
    bpm,
    confidence: seed.confidence,
    phase,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Empty-shape helper
// ────────────────────────────────────────────────────────────────────────────

function emptyAnalysis(
  sampleRate: number,
  duration: number,
  hopSize: number,
  framesPerSec: number,
): AudioAnalysis {
  const empty: BandSet = { bass: [], lowMids: [], mids: [], highs: [] };
  return {
    version: 1,
    sampleRate,
    duration,
    hopSize,
    framesPerSec,
    bands: empty,
    rms: [],
    onsetStrength: [],
    onsets: [],
    onsetsByBand: empty,
    beats: [],
    downbeats: [],
    tempo: null,
  };
}
