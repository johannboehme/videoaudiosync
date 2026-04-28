// Real-music sync benchmark.
//
// Loads side_a.wav + side_b.wav from ~/Downloads, decodes to mono PCM @
// 22050 Hz, builds a stack of (ref, query) pairs with KNOWN ground-truth
// offsets by slicing, padding, and noise-overlaying the real audio, and
// runs each through the WASM sync pipeline via Playwright (which loads
// the same WASM the editor uses).
//
// Outputs a per-scenario error table + a summary so we can compare
// algorithm changes against real-music quality, not synthetic patterns.
//
// Run with:  node scripts/bench-real-music.mjs
//   (requires the dev server on :5174 — for the WASM module URLs)

import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BASE = "http://localhost:5174";
const DOWNLOADS = "/Users/devien/Downloads";

// Top-1 must hit within ±60 ms (the practical chroma-hop resolution).
// Snap-to-alternate-match in the UI accepts wider — within ±300 ms is
// "you can nudge to perfect from here". Recall@K uses the wider window.
const TOL_MS = 60;
const RECALL_TOL_MS = 300;

function loadWav(path) {
  const buf = readFileSync(path);
  // Minimal WAV parser — assumes PCM 16-bit or 32-bit float, mono or stereo.
  if (buf.toString("ascii", 0, 4) !== "RIFF") throw new Error(`${path}: not RIFF`);
  let p = 12;
  let fmt = null;
  let dataStart = -1;
  let dataSize = 0;
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
  if (!fmt || dataStart < 0) throw new Error(`${path}: missing fmt/data chunk`);

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
    throw new Error(`${path}: unsupported fmt ${fmt.format}/${fmt.bitsPerSample}`);
  }
  return { pcm: out, sampleRate: fmt.sampleRate };
}

// Resample mono PCM by linear interpolation to 22050 Hz.
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

const TARGET_SR = 22050;

function sliceS(pcm, fromS, toS) {
  return pcm.slice(
    Math.max(0, Math.floor(fromS * TARGET_SR)),
    Math.floor(toS * TARGET_SR),
  );
}

function silence(secs) {
  return new Float32Array(Math.floor(secs * TARGET_SR));
}

function noise(secs, amp, seed = 1) {
  let s = seed;
  const out = new Float32Array(Math.floor(secs * TARGET_SR));
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    out[i] = ((s / 0x7fffffff) * 2 - 1) * amp;
  }
  return out;
}

function concat(...arrays) {
  let n = 0;
  for (const a of arrays) n += a.length;
  const out = new Float32Array(n);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

function mix(...arrays) {
  const n = Math.max(...arrays.map((a) => a.length));
  const out = new Float32Array(n);
  for (const a of arrays) {
    for (let i = 0; i < a.length; i++) out[i] += a[i];
  }
  return out;
}

function buildScenarios(side_a, side_b) {
  const scenarios = [];

  // 30-second chunks from each side at varied positions.
  const a30 = sliceS(side_a, 30, 60);
  const a45 = sliceS(side_a, 60, 105);
  const b30 = sliceS(side_b, 0, 30);

  // 1. Identity
  scenarios.push({
    name: "real-side_a-30s-identity",
    ref: a30,
    query: a30,
    expectedOffsetMs: 0,
    tolMs: TOL_MS,
  });

  // 2-5. Real music shifted by various positive offsets (master appears later in ref).
  for (const offMs of [200, 800, 2500, 7500]) {
    const padS = offMs / 1000;
    const ref = concat(silence(padS), a30);
    scenarios.push({
      name: `real-side_a-pos-${offMs}ms`,
      ref,
      query: a30,
      expectedOffsetMs: offMs,
      tolMs: TOL_MS,
    });
  }

  // 6-9. Negative offsets (query starts later → ref is missing the prefix).
  for (const offMs of [200, 800, 2500, 7500]) {
    const padS = offMs / 1000;
    const query = concat(silence(padS), a30);
    scenarios.push({
      name: `real-side_a-neg-${offMs}ms`,
      ref: a30,
      query,
      expectedOffsetMs: -offMs,
      tolMs: TOL_MS,
    });
  }

  // 10. Phone-recording approximation: ref = master + low-level noise overlay.
  {
    const n = noise(a30.length / TARGET_SR, 0.04, 17);
    const ref = mix(a30, n);
    scenarios.push({
      name: "real-side_a-phone-noise-overlay",
      ref,
      query: a30,
      expectedOffsetMs: 0,
      tolMs: TOL_MS,
    });
  }

  // 11. Quiet-mic phone recording (master attenuated 5×).
  {
    const ref = a30.map((x) => x * 0.2);
    scenarios.push({
      name: "real-side_a-attenuated-5x",
      ref: new Float32Array(ref),
      query: a30,
      expectedOffsetMs: 0,
      tolMs: TOL_MS,
    });
  }

  // 12. Long phone recording with chatter before the music starts.
  //     ref = silence(1) + noise(2) + master, query = master.
  {
    const ref = concat(silence(1), noise(2, 0.06, 99), a30);
    scenarios.push({
      name: "real-side_a-chatter-then-music",
      ref,
      query: a30,
      expectedOffsetMs: 3000,
      tolMs: TOL_MS,
    });
  }

  // 13. Long ref with master in the middle.
  {
    const ref = concat(silence(15), a30, silence(8));
    scenarios.push({
      name: "real-side_a-music-in-the-middle",
      ref,
      query: a30,
      expectedOffsetMs: 15000,
      tolMs: TOL_MS,
    });
  }

  // 14. Short query inside a long ref.
  {
    const inner = sliceS(side_a, 90, 100); // 10 s
    const ref = concat(silence(7), inner, silence(13));
    scenarios.push({
      name: "real-side_a-10s-query-in-30s-ref",
      ref,
      query: inner,
      expectedOffsetMs: 7000,
      tolMs: TOL_MS,
    });
  }

  // 15. Different track at front, target track behind (simulates an intro).
  {
    const intro = sliceS(side_a, 5, 13);
    const ref = concat(intro, a30);
    scenarios.push({
      name: "real-side_a-intro-then-target",
      ref,
      query: a30,
      expectedOffsetMs: 8000,
      tolMs: TOL_MS,
    });
  }

  // 16-17. Cross-track sanity using side_b as a totally different song.
  scenarios.push({
    name: "real-side_b-30s-identity",
    ref: b30,
    query: b30,
    expectedOffsetMs: 0,
    tolMs: TOL_MS,
  });
  // 17. Different songs — algorithm should report low confidence (no
  //     valid match). Won't fail the bench (no expected offset to hit),
  //     but logged for visibility.
  scenarios.push({
    name: "real-cross-track-side_a-vs-side_b",
    ref: a30,
    query: b30,
    expectedOffsetMs: null, // sentinel: we don't grade this
    tolMs: 0,
  });

  // 18-20. The user's other use case: a long ref (60-90 s) with master
  //        somewhere inside.
  for (const startS of [0, 25, 60]) {
    const ref = concat(silence(startS), a30, silence(10));
    scenarios.push({
      name: `real-side_a-long-ref-start-${startS}s`,
      ref,
      query: a30,
      expectedOffsetMs: startS * 1000,
      tolMs: TOL_MS,
    });
  }

  // 21. Same recording on a longer query (with trailing silence).
  {
    const query = concat(a30, silence(5));
    scenarios.push({
      name: "real-side_a-query-with-trailing-silence",
      ref: a30,
      query,
      expectedOffsetMs: 0,
      tolMs: TOL_MS,
    });
  }

  return scenarios;
}

(async () => {
  console.log("loading WAV files…");
  const a = loadWav(join(DOWNLOADS, "side_a.wav"));
  const b = loadWav(join(DOWNLOADS, "side_b.wav"));
  console.log(`  side_a: ${(a.pcm.length / a.sampleRate).toFixed(1)}s @ ${a.sampleRate}`);
  console.log(`  side_b: ${(b.pcm.length / b.sampleRate).toFixed(1)}s @ ${b.sampleRate}`);

  const a22 = resample(a.pcm, a.sampleRate, TARGET_SR);
  const b22 = resample(b.pcm, b.sampleRate, TARGET_SR);

  const scenarios = buildScenarios(a22, b22);
  console.log(`built ${scenarios.length} scenarios`);

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));

  // Load the WASM via the dev server's module graph.
  await page.goto(`${BASE}/upload`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1000);

  console.log("\n=== Real-music sync benchmark ===\n");
  console.log(
    `${"scenario".padEnd(46)}  ${"expected_ms".padStart(12)}  ${"got_ms".padStart(12)}  ${"err_ms".padStart(10)}  ${"conf".padStart(6)}  alts`,
  );
  console.log("-".repeat(120));

  let total = 0;
  let passed = 0;
  let recall_k = 0;
  let totalAbsErr = 0;
  let scoredCount = 0;

  for (const s of scenarios) {
    // syncAudioPcm via WASM — push the typed-arrays into the page context.
    const result = await page.evaluate(
      async ({ refBytes, queryBytes, sr }) => {
        const ref = new Float32Array(refBytes);
        const query = new Float32Array(queryBytes);
        const mod = await import("/wasm/sync-core/pkg/sync_core.js");
        await mod.default();
        const r = mod.syncAudioPcm(ref, query, sr);
        return r;
      },
      {
        refBytes: Array.from(s.ref),
        queryBytes: Array.from(s.query),
        sr: TARGET_SR,
      },
    );

    total++;
    const got = result.offset_ms;
    const conf = result.confidence;
    const alts = result.candidates ?? [];
    if (s.expectedOffsetMs === null) {
      console.log(
        `${s.name.padEnd(46)}  ${"—".padStart(12)}  ${got.toFixed(1).padStart(12)}  ${"—".padStart(10)}  ${conf.toFixed(2).padStart(6)}  ${alts.length}`,
      );
      continue;
    }
    scoredCount++;
    const err = got - s.expectedOffsetMs;
    const absErr = Math.abs(err);
    const ok = absErr <= s.tolMs;
    // Snap-to-alternate window is wider than the strict top-1 tolerance.
    // The user can manually nudge a snapped alternate to perfect — getting
    // them within ~300 ms is the bar.
    const recallHit = alts.some(
      (c) => Math.abs(c.offset_ms - s.expectedOffsetMs) <= RECALL_TOL_MS,
    );
    if (ok) passed++;
    if (recallHit) recall_k++;
    totalAbsErr += absErr;
    const altsBrief = alts
      .map((c) => `${c.offset_ms.toFixed(0)}@${c.confidence.toFixed(2)}`)
      .join(",");
    console.log(
      `${s.name.padEnd(46)}  ${s.expectedOffsetMs.toFixed(1).padStart(12)}  ${got.toFixed(1).padStart(12)}  ${err.toFixed(1).padStart(10)}  ${conf.toFixed(2).padStart(6)}  ${ok ? "✓" : "✗"} ${recallHit ? `R@${alts.length}` : "—"}${ok ? "" : "   alts=[" + altsBrief + "]"}`,
    );
  }

  console.log("\n=== Summary ===");
  console.log(`Top-1 pass:   ${passed}/${scoredCount} (${((100 * passed) / scoredCount).toFixed(0)}%)`);
  console.log(`Recall@K:     ${recall_k}/${scoredCount} (${((100 * recall_k) / scoredCount).toFixed(0)}%)`);
  console.log(`Mean abs err: ${(totalAbsErr / scoredCount).toFixed(1)} ms`);
  console.log(`(${total - scoredCount} ungraded sanity scenarios)`);

  await browser.close();
})();
