// Loop-glitch benchmark.
//
// Verifies that the gapless-loop architecture (two-<audio> ping-pong +
// WebAudio crossfade in useAudioMaster) produces NO sample-to-sample
// discontinuities at loop wrap.
//
// Mechanism:
//   1. Generate a continuous 440Hz sine (30s) + dummy video fixtures.
//   2. Seed a synced job into IndexedDB/OPFS (same scheme as
//      bench-press-to-paint.mjs).
//   3. Open the editor with ?perf=1 (which activates the AudioWorklet
//      glitch probe).
//   4. Set a loop region inside the audio (loop length = 1s for fast
//      iteration → many wraps in a short bench).
//   5. Play for N seconds, read `window.__loopGlitches`.
//   6. Fail if any glitches were detected within the loop window.
//
// Run:  node scripts/bench-loop-glitch.mjs
// (Requires dev server on localhost:5174 + ffmpeg on PATH.)

import { chromium } from "playwright";
import { readFile, stat, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const URL = process.env.URL ?? "http://localhost:5174/?perf=1";
const FIXTURES_DIR = path.join(process.cwd(), "test-fixtures");
const PLAY_SECONDS = Number(process.env.PLAY_S ?? 12);
const LOOP_START_S = 5;
const LOOP_END_S = 6; // 1s loop → ~7 wraps in 12s of playback
const FIXTURE_DURATION_S = 30;

async function ensureFixture(name, ffmpegArgs) {
  const target = path.join(FIXTURES_DIR, name);
  try {
    await stat(target);
    return;
  } catch {
    /* generate */
  }
  await mkdir(FIXTURES_DIR, { recursive: true });
  console.error(`[bench] generating ${name}…`);
  const r = spawnSync("ffmpeg", ["-y", ...ffmpegArgs, target], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  if (r.status !== 0) {
    throw new Error(
      `ffmpeg failed for ${name} (exit ${r.status}). Is ffmpeg on PATH?`,
    );
  }
}

await ensureFixture("loop-cam.mp4", [
  "-f", "lavfi", "-i", `mandelbrot=size=1920x1080:rate=30,format=yuv420p`,
  "-t", String(FIXTURE_DURATION_S), "-c:v", "libx264", "-preset", "medium",
  "-b:v", "4M", "-pix_fmt", "yuv420p",
]);
await ensureFixture("loop-master.wav", [
  "-f", "lavfi", "-i", `sine=f=440:d=${FIXTURE_DURATION_S}`,
  "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
]);

const [camBuf, audioBuf] = await Promise.all([
  readFile(path.join(FIXTURES_DIR, "loop-cam.mp4")),
  readFile(path.join(FIXTURES_DIR, "loop-master.wav")),
]);
const camB64 = camBuf.toString("base64");
const audioB64 = audioBuf.toString("base64");

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== "0",
  args: process.env.HEADLESS === "0"
    ? []
    : [
        "--use-gl=angle",
        "--enable-gpu-rasterization",
        "--enable-zero-copy",
        "--ignore-gpu-blocklist",
        "--enable-features=Vulkan,VaapiVideoDecoder",
      ],
});
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
});
const page = await ctx.newPage();

const consoleErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
});
page.on("pageerror", (e) => consoleErrors.push(`pageerror: ${e.message}`));

await page.goto(URL, { waitUntil: "domcontentloaded" });

const isolated = await page.evaluate(
  () => crossOriginIsolated && typeof SharedArrayBuffer !== "undefined",
);
if (!isolated) {
  console.error("FAIL: cross-origin isolation not active");
  process.exit(2);
}

const jobId = "loopglitch" + Math.random().toString(36).slice(2, 8);
await page.evaluate(
  async ({ jobId, camB64, audioB64, durationS }) => {
    function b64ToBlob(b64, mime) {
      const bin = atob(b64);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      return new Blob([arr], { type: mime });
    }
    async function dir(parent, name) {
      return await parent.getDirectoryHandle(name, { create: true });
    }
    async function writeFile(parent, name, blob) {
      const fh = await parent.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
    }
    const root = await navigator.storage.getDirectory();
    const jobsDir = await dir(root, "jobs");
    const jobDir = await dir(jobsDir, jobId);
    await writeFile(jobDir, "cam-1.mp4", b64ToBlob(camB64, "video/mp4"));
    await writeFile(jobDir, "audio.wav", b64ToBlob(audioB64, "audio/wav"));

    const dbReq = indexedDB.open("videoaudiosync", 3);
    const db = await new Promise((resolve, reject) => {
      dbReq.onupgradeneeded = () => {
        const d = dbReq.result;
        if (!d.objectStoreNames.contains("jobs")) {
          const s = d.createObjectStore("jobs", { keyPath: "id" });
          s.createIndex("by-createdAt", "createdAt");
        }
        if (!d.objectStoreNames.contains("audio-analysis")) {
          d.createObjectStore("audio-analysis", { keyPath: "jobId" });
        }
      };
      dbReq.onsuccess = () => resolve(dbReq.result);
      dbReq.onerror = () => reject(dbReq.error);
    });

    const job = {
      id: jobId,
      title: "loop-glitch-bench",
      videoFilename: "loop-cam.mp4",
      audioFilename: "audio.wav",
      status: "synced",
      progress: { pct: 100, stage: "synced" },
      hasOutput: false,
      createdAt: Date.now(),
      schemaVersion: 2,
      durationS,
      width: 1920,
      height: 1080,
      fps: 30,
      videos: [
        {
          kind: "video",
          id: "cam-1",
          filename: "loop-cam.mp4",
          opfsPath: `jobs/${jobId}/cam-1.mp4`,
          color: "#FF5722",
          durationS,
          width: 1920,
          height: 1080,
          fps: 30,
          sync: { offsetMs: 0, driftRatio: 1, confidence: 1 },
        },
      ],
      cuts: [],
      sync: { offsetMs: 0, driftRatio: 1, confidence: 1 },
    };

    await new Promise((resolve, reject) => {
      const tx = db.transaction("jobs", "readwrite");
      tx.objectStore("jobs").put(job);
      tx.oncomplete = () => resolve(undefined);
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  },
  { jobId, camB64, audioB64, durationS: FIXTURE_DURATION_S },
);

await page.goto(`http://localhost:5174/job/${jobId}/edit?perf=1`, {
  waitUntil: "domcontentloaded",
});

await page.waitForFunction(
  () => !document.body?.innerText?.includes("Loading editor"),
  null,
  { timeout: 15000 },
);

// Let audio analysis + cam warmup settle.
await page.waitForTimeout(2000);

// Set the loop region directly via the store + start playback. Going
// through the UI would require knowing the timeline geometry; the
// store API is stable and is exactly what the IN/OUT buttons call.
await page.evaluate(
  async ({ start, end }) => {
    // The editor exposes `useEditorStore` on window for perf-mode
    // diagnostics — see Editor.tsx. If it isn't there, fall back to
    // a manual Spacebar + 'i'/'o' UI sequence (TODO).
    const store = window.__editorStore;
    if (!store) throw new Error("editor store not exposed on window");
    const s = store.getState();
    s.seek(start);
    s.setLoop({ start, end });
    s.setPlaying(true);
  },
  { start: LOOP_START_S, end: LOOP_END_S },
);

// Reset glitch counter to ignore start-of-playback artefacts (the
// first audio.play() can produce a non-glitch transient).
await page.evaluate(() => {
  window.__loopGlitches = [];
});

await page.waitForTimeout(PLAY_SECONDS * 1000);

const glitches = await page.evaluate(() => window.__loopGlitches ?? []);

// Stop playback so the timer stops counting.
await page.evaluate(() => {
  const store = window.__editorStore;
  if (store) store.getState().setPlaying(false);
});

// Compute expected wrap timestamps in masterTime (start at the first
// wrap = LOOP_END_S, then every (LOOP_END_S - LOOP_START_S)).
const loopLen = LOOP_END_S - LOOP_START_S;
const expectedWraps = [];
for (let t = LOOP_END_S; t <= LOOP_END_S + PLAY_SECONDS; t += loopLen) {
  expectedWraps.push(+t.toFixed(3));
}

// Note: glitch ctxTime is in AudioContext-time, not masterTime. Glitches
// that fall NEAR a wrap (within ±50 ms) are the ones that indicate a
// regression. Glitches outside any wrap window are unrelated artefacts
// (decoder warmup, etc.) and we do not fail on them.
const wrapWindowS = 0.05;
const wrapAlignedGlitches = glitches; // expose all; reporter decides

await browser.close();

const summary = {
  jobId,
  loopRegion: { start: LOOP_START_S, end: LOOP_END_S, lengthS: loopLen },
  expectedWraps: expectedWraps.length,
  totalGlitchesDetected: glitches.length,
  glitches: glitches.slice(0, 20),
  consoleErrors: consoleErrors.slice(0, 20),
  wrapWindowS,
  pass: wrapAlignedGlitches.length === 0,
};

if (process.env.JSON === "1") {
  console.log(JSON.stringify(summary));
} else {
  console.log("---- loop-glitch bench ----");
  console.log(`expected wraps: ${summary.expectedWraps}`);
  console.log(`glitches detected: ${summary.totalGlitchesDetected}`);
  if (summary.glitches.length > 0) {
    console.log("first 20:", JSON.stringify(summary.glitches, null, 2));
  }
  if (consoleErrors.length > 0) {
    console.log("console errors:", consoleErrors);
  }
  console.log(summary.pass ? "PASS" : "FAIL");
}

process.exit(summary.pass ? 0 : 1);
