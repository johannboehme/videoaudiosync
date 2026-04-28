// Compare cut transitions in an exported video against beat positions
// derived from the same file's audio. The exported render alternates
// between a portrait camera (only L/R black bars — top edge is video) and
// a rotated landscape camera (full black border on all sides — top edge
// is black). A cut is a frame where the classification flips.
//
// Inputs: cuts_audio.wav and cuts_frames.rgb under /tmp (produced by the
// caller's ffmpeg invocation).

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { createServer } from "vite";

const TARGET_SR = 22050;
const FRAMES_PATH = "/tmp/cuts_frames.rgb";
const AUDIO_PATH = "/tmp/cuts_audio.wav";
const FRAME_W = 64;
const FRAME_H = 96;
const FRAME_BYTES = FRAME_W * FRAME_H * 3;
const FPS = 30;

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
  const bytesPerSample = fmt.bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / bytesPerSample);
  const sampleFrames = Math.floor(totalSamples / fmt.channels);
  const out = new Float32Array(sampleFrames);
  for (let i = 0; i < sampleFrames; i++) {
    let s = 0;
    for (let c = 0; c < fmt.channels; c++) {
      s += buf.readInt16LE(dataStart + (i * fmt.channels + c) * 2) / 0x8000;
    }
    out[i] = s / fmt.channels;
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

// Sample the top + bottom edge of the frame in the centre 50 % of x.
// "Black border" cams have both edges close to 0; portrait cam has the
// top edge full of video brightness.
function classifyFrame(buf, frameIdx) {
  const off = frameIdx * FRAME_BYTES;
  const topY = 4;
  const botY = FRAME_H - 5;
  const xLo = Math.floor(FRAME_W * 0.25);
  const xHi = Math.floor(FRAME_W * 0.75);

  const sampleRow = (y) => {
    let acc = 0;
    let n = 0;
    for (let x = xLo; x < xHi; x++) {
      const p = off + (y * FRAME_W + x) * 3;
      acc += (buf[p] + buf[p + 1] + buf[p + 2]) / 3;
      n++;
    }
    return acc / n;
  };
  const top = sampleRow(topY);
  const bot = sampleRow(botY);
  // Both edges dark → bordered cam (cam-2). Either edge bright → portrait cam (cam-1).
  const BLACK_THR = 25; // ~10 % brightness on 0-255 scale
  const isBordered = top < BLACK_THR && bot < BLACK_THR;
  return { mode: isBordered ? "border" : "portrait", top, bot };
}

async function main() {
  console.log("loading audio + frames…");
  const wav = loadWav(AUDIO_PATH);
  const pcm = resample(wav.pcm, wav.sampleRate, TARGET_SR);
  const frames = readFileSync(FRAMES_PATH);
  const numFrames = Math.floor(frames.length / FRAME_BYTES);
  console.log(`  audio: ${wav.sampleRate} → ${TARGET_SR}, ${(pcm.length / TARGET_SR).toFixed(2)} s`);
  console.log(`  frames: ${numFrames} @ ${FPS} fps = ${(numFrames / FPS).toFixed(2)} s`);

  // Classify every frame.
  const modes = new Array(numFrames);
  const tops = new Array(numFrames);
  const bots = new Array(numFrames);
  for (let i = 0; i < numFrames; i++) {
    const c = classifyFrame(frames, i);
    modes[i] = c.mode;
    tops[i] = c.top;
    bots[i] = c.bot;
  }

  // Find cuts: frames where mode[i] != mode[i-1].
  const cuts = [];
  for (let i = 1; i < modes.length; i++) {
    if (modes[i] !== modes[i - 1]) cuts.push(i);
  }
  console.log(`  classified: ${cuts.length} mode flips`);

  // De-noise: collapse pairs of flips closer than 100 ms — a portrait
  // frame inside a long border stretch is a misclassified frame, not a
  // genuine 1-frame cut back-and-forth.
  const MIN_CUT_GAP_FRAMES = Math.round(0.1 * FPS);
  const cleanedCuts = [];
  for (const c of cuts) {
    if (cleanedCuts.length === 0) {
      cleanedCuts.push(c);
      continue;
    }
    const last = cleanedCuts[cleanedCuts.length - 1];
    if (c - last < MIN_CUT_GAP_FRAMES) {
      // Bounce — drop both.
      cleanedCuts.pop();
    } else {
      cleanedCuts.push(c);
    }
  }
  console.log(`  de-noised: ${cleanedCuts.length} real cuts`);

  // Bring up the analysis pipeline.
  const server = await createServer({
    server: { middlewareMode: true },
    appType: "custom",
    optimizeDeps: { include: [] },
  });
  const mod = await server.ssrLoadModule("/src/local/render/audio-analysis/analyze.ts");
  const { analyzeAudio } = mod;
  const a = analyzeAudio(pcm, TARGET_SR);
  await server.close();
  if (!a.tempo) {
    console.log("no tempo detected");
    return;
  }
  console.log(
    `  audioStartS ${a.audioStartS.toFixed(3)} s   tempo.bpm ${a.tempo.bpm.toFixed(3)}   tempo.phase ${a.tempo.phase.toFixed(3)} s   beats: ${a.beats.length}`,
  );

  // Snap-to-bar grid: with snap mode "1", each cut should land on a bar
  // line = phase + k · barS, where barS = 4 · 60/bpm (4/4 fixed in V1).
  const bpm = a.tempo.bpm;
  const phase = a.tempo.phase;
  const beatS = 60 / bpm;
  const barS = beatS * 4;

  console.log("\ncut_idx    cut_time     nearest bar     Δ(ms)     ");
  let totalErr = 0;
  let sumAbs = 0;
  let maxAbs = 0;
  for (let i = 0; i < cleanedCuts.length; i++) {
    const f = cleanedCuts[i];
    // The cut happens visually on frame f — its onscreen time is f / FPS.
    // The instant the user perceives the change is the start of frame f,
    // since prior frames are still showing the old cam.
    const cutT = f / FPS;
    const k = Math.round((cutT - phase) / barS);
    const grid = phase + k * barS;
    const err = (cutT - grid) * 1000;
    totalErr += err;
    sumAbs += Math.abs(err);
    if (Math.abs(err) > maxAbs) maxAbs = Math.abs(err);
    if (i < 12 || i >= cleanedCuts.length - 6) {
      console.log(
        `  ${i.toString().padStart(3)}    ${cutT.toFixed(3)} s   ${grid.toFixed(3)} s   ${err.toFixed(1).padStart(8)} ms`,
      );
    } else if (i === 12) {
      console.log("  …");
    }
  }
  console.log(
    `\nsummary: ${cleanedCuts.length} cuts   mean Δ ${(totalErr / cleanedCuts.length).toFixed(1)} ms   mean |Δ| ${(sumAbs / cleanedCuts.length).toFixed(1)} ms   max |Δ| ${maxAbs.toFixed(1)} ms`,
  );

  // Debug: linear-fit through all detected beats. If our regression
  // really nails the music's true period, this slope should match the
  // implied cut period (≈ 2.000 s for this user).
  {
    const n = a.beats.length;
    let sk = 0, sk2 = 0, st = 0, skt = 0;
    for (let i = 0; i < n; i++) {
      sk += i; sk2 += i * i; st += a.beats[i]; skt += i * a.beats[i];
    }
    const denom = n * sk2 - sk * sk;
    const period = (n * skt - sk * st) / denom;
    const intercept = (st - period * sk) / n;
    console.log(`\nbeat-array regression: period ${period.toFixed(6)} s   intercept ${intercept.toFixed(4)} s   ⇒ BPM ${(60 / period).toFixed(4)}`);
    console.log(`first 5 beats: ${a.beats.slice(0, 5).map((b) => b.toFixed(4)).join(", ")}`);
    console.log(`last 5 beats:  ${a.beats.slice(-5).map((b) => b.toFixed(4)).join(", ")}`);

    const intervals = [];
    for (let i = 1; i < a.beats.length; i++) intervals.push(a.beats[i] - a.beats[i - 1]);
    const sortedI = [...intervals].sort((a, b) => a - b);
    const median = sortedI[Math.floor(sortedI.length / 2)];
    const q10 = sortedI[Math.floor(sortedI.length * 0.1)];
    const q90 = sortedI[Math.floor(sortedI.length * 0.9)];
    const trim = Math.floor(sortedI.length * 0.1);
    const kept = sortedI.slice(trim, sortedI.length - trim);
    const trimmed = kept.reduce((s, x) => s + x, 0) / kept.length;
    console.log(
      `intervals  median ${median.toFixed(5)}   trimmed-mean ${trimmed.toFixed(5)}   q10 ${q10.toFixed(5)}   q90 ${q90.toFixed(5)}   min ${sortedI[0].toFixed(5)}   max ${sortedI[sortedI.length - 1].toFixed(5)}`,
    );
    // Bin the intervals to see their distribution.
    const bins = {};
    for (const v of intervals) {
      const key = (Math.round(v * 1000) / 1000).toFixed(3);
      bins[key] = (bins[key] || 0) + 1;
    }
    const sortedBins = Object.entries(bins).sort((a, b) => Number(a[0]) - Number(b[0]));
    console.log("histogram (interval s → count):");
    for (const [k, v] of sortedBins) console.log(`  ${k}: ${"█".repeat(Math.min(60, v))} ${v}`);
  }

  // Same comparison against the beat grid (= bar grid here, because
  // snap=1; we still print it for sanity in case beat alignment differs
  // from the bar phase).
  console.log("\nrelative to nearest detected beat (any beat in beats[]):");
  let beatSumAbs = 0;
  let beatMaxAbs = 0;
  for (const f of cleanedCuts) {
    const cutT = f / FPS;
    let bestErr = Infinity;
    for (const b of a.beats) {
      const e = cutT - b;
      if (Math.abs(e) < Math.abs(bestErr)) bestErr = e;
    }
    beatSumAbs += Math.abs(bestErr);
    if (Math.abs(bestErr) > beatMaxAbs) beatMaxAbs = Math.abs(bestErr);
  }
  console.log(
    `  mean |Δ| to nearest beat: ${(beatSumAbs / cleanedCuts.length * 1000).toFixed(1)} ms   max |Δ|: ${(beatMaxAbs * 1000).toFixed(1)} ms`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
