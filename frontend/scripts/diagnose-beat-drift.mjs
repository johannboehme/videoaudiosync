// Diagnose beat-grid alignment + audio-start detection on real WAVs.
//
// For each input file:
//   1. Decode (mono, 22050 Hz target).
//   2. Find when the actual performance starts (RMS rises above the
//      noise-floor of the silent intro).
//   3. Run the production analyzeAudio pipeline.
//   4. Print: detected audio-start, tempo.bpm/phase, beats[0..2],
//      and the gap between audio-start and the first detected beat.
//
// What we want to see: tempo.phase ≥ audioStart, and beats[0] very
// close to audioStart (within ~1 hop). If beats[0] << audioStart, the
// onset detector is finding spurious "beats" in the silence before the
// music — which is the bug behind the misaligned bar ruler.
//
// Run with:  node scripts/diagnose-beat-drift.mjs [file ...]
//   defaults to ~/Downloads/side_{a,b,c}.wav

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createServer } from "vite";

const DOWNLOADS = "/Users/devien/Downloads";
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

// RMS in 50 ms windows. Returns array of {tS, rms}.
function rmsWindows(pcm, sampleRate, winS = 0.05) {
  const win = Math.max(1, Math.round(sampleRate * winS));
  const n = Math.floor(pcm.length / win);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0;
    const start = i * win;
    for (let j = 0; j < win; j++) {
      const v = pcm[start + j];
      acc += v * v;
    }
    out[i] = { tS: (i * win) / sampleRate, rms: Math.sqrt(acc / win) };
  }
  return out;
}

function db(x) {
  return 20 * Math.log10(Math.max(1e-12, x));
}

async function diagnoseFile(path, analyzeAudio) {
  console.log(`\n──── ${path} ────`);
  const wav = loadWav(path);
  console.log(`  src: ${wav.sampleRate} Hz, ${(wav.pcm.length / wav.sampleRate).toFixed(2)} s`);
  const pcm = resample(wav.pcm, wav.sampleRate, TARGET_SR);

  // Audio-start: RMS-based. Take the median RMS of the quietest 25 % of
  // the windows as the noise-floor estimate, set the threshold at
  // max(noise * 8, -40 dBFS), and call audio-start the first window
  // whose RMS crosses that.
  const rms = rmsWindows(pcm, TARGET_SR, 0.05);
  const sorted = [...rms].map((r) => r.rms).sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.25)];
  const peakRms = sorted[sorted.length - 1];
  const ABS_FLOOR = 0.01; // -40 dBFS
  const thr = Math.max(ABS_FLOOR, noiseFloor * 8);
  let audioStartS = 0;
  for (const r of rms) {
    if (r.rms > thr) {
      audioStartS = r.tS;
      break;
    }
  }
  console.log(
    `  noise-floor ≈ ${db(noiseFloor).toFixed(1)} dBFS (rms ${noiseFloor.toExponential(2)})   peak ${db(peakRms).toFixed(1)} dBFS   threshold ${db(thr).toFixed(1)} dBFS`,
  );
  console.log(`  audio-start (RMS-cross): ${audioStartS.toFixed(3)} s`);

  console.time("  analyze");
  const a = analyzeAudio(pcm, TARGET_SR);
  console.timeEnd("  analyze");
  if (!a.tempo) {
    console.log("  no tempo detected");
    return;
  }
  console.log(
    `  analyzeAudio.audioStartS ${a.audioStartS.toFixed(3)} s   (script-RMS said ${audioStartS.toFixed(3)} s)`,
  );
  console.log(
    `  tempo.bpm ${a.tempo.bpm.toFixed(3)}   tempo.phase ${a.tempo.phase.toFixed(3)} s   beats: ${a.beats.length}   onsets: ${a.onsets.length}`,
  );
  console.log(
    `  beats[0..2]: ${a.beats.slice(0, 3).map((b) => b.toFixed(3)).join(", ")} s`,
  );
  console.log(
    `  onsets[0..2]: ${a.onsets.slice(0, 3).map((b) => b.toFixed(3)).join(", ")} s`,
  );
  const gapBeat0 = a.beats[0] !== undefined ? a.beats[0] - audioStartS : NaN;
  const gapPhase = a.tempo.phase - audioStartS;
  console.log(
    `  gap beats[0]−audioStart: ${(gapBeat0 * 1000).toFixed(0)} ms`,
  );
  console.log(
    `  gap tempo.phase−audioStart: ${(gapPhase * 1000).toFixed(0)} ms`,
  );
  if (gapBeat0 < -0.1) {
    console.log(`  ⚠  beats[0] is BEFORE audio-start by ${(-gapBeat0).toFixed(2)} s — spurious onsets in the silent intro`);
  }
}

async function main() {
  const files = process.argv.slice(2);
  const targets = files.length
    ? files
    : ["side_a", "side_b", "side_c"].map((n) => join(DOWNLOADS, `${n}.wav`));

  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { include: [] },
  });
  const mod = await server.ssrLoadModule("/src/local/render/audio-analysis/analyze.ts");
  const { analyzeAudio } = mod;

  for (const t of targets) {
    try {
      await diagnoseFile(t, analyzeAudio);
    } catch (e) {
      console.error(`error on ${t}:`, e.message);
    }
  }

  await server.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
