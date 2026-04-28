// Diagnose accumulating beat-grid drift on a real-music WAV.
//
// Loads side_c.wav from ~/Downloads, decodes to mono PCM @ 22050 Hz,
// runs the production analyzeAudio pipeline, and prints metrics that
// expose two suspected bugs:
//
//   1. STFT window-start vs window-center bias: a constant ~46 ms
//      offset on every reported event time at sr=22050, N_FFT=2048.
//
//   2. BPM precision: the autocorrelation peak refined parabolically
//      may have a residual error of ~0.1 frame, which translates to
//      ~0.5 BPM at 120 BPM, which compounds linearly into hundreds of
//      ms of drift across a 90-second track.
//
// Run with:  node scripts/diagnose-beat-drift.mjs
//
// We import analyze.ts via vitest's transformer.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { createServer } from "vite";

const DOWNLOADS = "/Users/devien/Downloads";
const WAV = join(DOWNLOADS, "side_c.wav");
const TARGET_SR = 22050;

function loadWav(path) {
  const buf = readFileSync(path);
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${path}: not RIFF`);
  let p = 12, fmt = null, dataStart = -1, dataSize = 0;
  while (p < buf.length - 8) {
    const tag = buf.toString("ascii", p, p + 4);
    const size = buf.readUInt32LE(p + 4);
    if (tag === "fmt ") {
      fmt = {
        format: buf.readUInt16LE(p + 8),
        channels: buf.readUInt16LE(p + 10),
        sampleRate: buf.readUInt32LE(p + 12),
        bitsPerSample: buf.readUInt16LE(p + 22),
      };
    } else if (tag === "data") {
      dataStart = p + 8;
      dataSize = size;
      break;
    }
    p += 8 + size;
  }
  if (!fmt || dataStart < 0) throw new Error("missing chunks");
  const bytesPerSample = fmt.bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const sampleFrames = Math.floor(totalSamples / fmt.channels);
  const out = new Float32Array(sampleFrames);
  if (fmt.format === 1 && fmt.bitsPerSample === 16) {
    for (let i = 0; i < sampleFrames; i++) {
      let s = 0;
      for (let c = 0; c < fmt.channels; c++) {
        s += buf.readInt16LE(dataStart + (i * fmt.channels + c) * 2) / 0x8000;
      }
      out[i] = s / fmt.channels;
    }
  } else if (fmt.format === 3 && fmt.bitsPerSample === 32) {
    for (let i = 0; i < sampleFrames; i++) {
      let s = 0;
      for (let c = 0; c < fmt.channels; c++) {
        s += buf.readFloatLE(dataStart + (i * fmt.channels + c) * 4);
      }
      out[i] = s / fmt.channels;
    }
  } else {
    throw new Error(`unsupported fmt ${fmt.format}/${fmt.bitsPerSample}`);
  }
  return { pcm: out, sampleRate: fmt.sampleRate };
}

function resample(pcm, fromSr, toSr) {
  if (fromSr === toSr) return pcm;
  const ratio = toSr / fromSr;
  const outLen = Math.floor(pcm.length * ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i / ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(pcm.length - 1, lo + 1);
    const t = srcIdx - lo;
    out[i] = pcm[lo] * (1 - t) + pcm[hi] * t;
  }
  return out;
}

async function main() {
  console.log(`loading ${WAV} …`);
  const wav = loadWav(WAV);
  console.log(
    `  src: ${wav.sampleRate} Hz mono-mixdown, ${(wav.pcm.length / wav.sampleRate).toFixed(2)} s`,
  );

  const pcm = resample(wav.pcm, wav.sampleRate, TARGET_SR);
  console.log(`  resampled to ${TARGET_SR} Hz, ${pcm.length} samples (${(pcm.length / TARGET_SR).toFixed(2)} s)`);

  // Spin up Vite in middleware mode so we can load analyze.ts directly.
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { include: [] },
  });

  const mod = await server.ssrLoadModule("/src/local/render/audio-analysis/analyze.ts");
  const { analyzeAudio } = mod;

  console.time("analyze");
  const a = analyzeAudio(pcm, TARGET_SR);
  console.timeEnd("analyze");

  await server.close();

  if (!a.tempo) {
    console.log("no tempo detected");
    return;
  }

  const bpm = a.tempo.bpm;
  const phase = a.tempo.phase;
  const period = 60 / bpm;

  console.log(``);
  console.log(`tempo: ${bpm.toFixed(4)} BPM   period: ${period.toFixed(6)} s   phase: ${phase.toFixed(6)} s   confidence: ${a.tempo.confidence.toFixed(3)}`);
  console.log(`beats: ${a.beats.length}   onsets: ${a.onsets.length}   downbeats: ${a.downbeats.length}`);

  // Residuals between the detected beats and their idealized grid position.
  // If the beat-tracker is rigid (large alpha) and the detected BPM is
  // precise, residuals should be tiny.
  const resid = a.beats.map((b, i) => b - (phase + i * period));
  const meanRes = resid.reduce((s, x) => s + x, 0) / resid.length;
  const maxAbsRes = Math.max(...resid.map(Math.abs));
  console.log(``);
  console.log(`beat-vs-grid residuals (over ${a.beats.length} beats):`);
  console.log(`  mean: ${(meanRes * 1000).toFixed(2)} ms   max abs: ${(maxAbsRes * 1000).toFixed(2)} ms`);

  // Linear-regression refit: fit a line through the detected beats to see
  // what the BPM/phase WOULD be if we used the actual beat positions
  // instead of the autocorrelation-derived tempo.
  const n = a.beats.length;
  const sumI = (n * (n - 1)) / 2;
  const sumI2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const sumT = a.beats.reduce((s, x) => s + x, 0);
  let sumIT = 0;
  for (let i = 0; i < n; i++) sumIT += i * a.beats[i];
  const denom = n * sumI2 - sumI * sumI;
  const slope = (n * sumIT - sumI * sumT) / denom;
  const intercept = (sumT - slope * sumI) / n;
  const bpmFit = 60 / slope;
  console.log(``);
  console.log(`linear-regression refit through detected beats:`);
  console.log(`  slope (period): ${slope.toFixed(6)} s   ⇒ BPM: ${bpmFit.toFixed(4)}`);
  console.log(`  intercept (phase): ${intercept.toFixed(6)} s`);
  console.log(`  Δ BPM detected vs refit: ${(bpmFit - bpm).toFixed(4)} BPM`);
  const driftPerSec = (bpmFit - bpm) / 60; // beats/sec drift
  const driftAcrossTrack = driftPerSec * (a.duration);
  console.log(`  ⇒ predicted grid-drift across track (${a.duration.toFixed(1)} s): ${(driftAcrossTrack * period * 1000).toFixed(1)} ms`);

  // For onsets: take onsets in first 25% of track and last 25%, compare
  // their typical distance to the nearest GRID line (using detected bpm,
  // phase). If grid-vs-music drifts, distances grow over time.
  const distToGrid = (t) => {
    const k = Math.round((t - phase) / period);
    return Math.abs(t - (phase + k * period));
  };
  const segOf = (frac) => {
    const lo = a.duration * frac;
    const hi = a.duration * (frac + 0.25);
    const seg = a.onsets.filter((t) => t >= lo && t < hi);
    if (seg.length === 0) return null;
    const dists = seg.map(distToGrid).sort((a, b) => a - b);
    const median = dists[Math.floor(dists.length / 2)];
    const mean = dists.reduce((s, x) => s + x, 0) / dists.length;
    return { count: seg.length, median, mean };
  };
  console.log(``);
  console.log(`onset-to-grid distance, by track quartile (smaller = better aligned):`);
  for (const frac of [0, 0.25, 0.5, 0.75]) {
    const s = segOf(frac);
    if (!s) {
      console.log(`  q${Math.round(frac * 4) + 1}: <no onsets>`);
      continue;
    }
    console.log(
      `  q${Math.round(frac * 4) + 1}: ${s.count.toString().padStart(3)} onsets   median ${(s.median * 1000).toFixed(1).padStart(5)} ms   mean ${(s.mean * 1000).toFixed(1).padStart(5)} ms`,
    );
  }

  console.log(``);
  console.log(`first 8 beats:`);
  for (let i = 0; i < Math.min(8, a.beats.length); i++) {
    const grid = phase + i * period;
    console.log(
      `  beat ${i.toString().padStart(2)}: detected ${a.beats[i].toFixed(4)} s   grid ${grid.toFixed(4)} s   Δ ${((a.beats[i] - grid) * 1000).toFixed(1)} ms`,
    );
  }
  console.log(`last 8 beats:`);
  for (let i = Math.max(0, a.beats.length - 8); i < a.beats.length; i++) {
    const grid = phase + i * period;
    console.log(
      `  beat ${i.toString().padStart(2)}: detected ${a.beats[i].toFixed(4)} s   grid ${grid.toFixed(4)} s   Δ ${((a.beats[i] - grid) * 1000).toFixed(1)} ms`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
