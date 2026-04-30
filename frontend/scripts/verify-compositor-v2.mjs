// Smoke test for the Phase-2 unified compositor (?compositor=v2).
// Seeds the same fake job the bench uses, opens the editor with the
// V2 flag, and verifies:
//   1. crossOriginIsolated active (real Chrome with COOP/COEP).
//   2. The new <canvas> is mounted (Compositor.tsx, not MultiCamPreview).
//   3. Canvas has non-blank pixels after a short warmup.
//   4. Cut hotkey switches the active cam (sampled colour changes).
//   5. F-hold paints a vignette (corner pixel darker than centre).
//   6. No console / page errors.
//
// Run:  node scripts/verify-compositor-v2.mjs   (dev server on :5173)
//       URL=http://localhost:5174 ... for the prod build / preview build.

import { chromium } from "playwright";
import { readFile, stat, mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";

const BASE = process.env.URL ?? "http://localhost:5173";
const FIXTURES_DIR = path.join(process.cwd(), "test-fixtures");

async function ensureFixture(name, ffmpegArgs) {
  const target = path.join(FIXTURES_DIR, name);
  try { await stat(target); return; } catch { /* fall through */ }
  await mkdir(FIXTURES_DIR, { recursive: true });
  console.error(`[verify-v2] generating ${name}…`);
  const r = spawnSync("ffmpeg", ["-y", ...ffmpegArgs, target], { stdio: "ignore" });
  if (r.status !== 0) throw new Error(`ffmpeg failed for ${name}`);
}
// Solid colour fixtures — easier to assert sampled pixel colours after
// the cut. mandelbrot/life would have varying pixels per frame.
await ensureFixture("v2-cam-red.mp4", [
  "-f", "lavfi", "-i", "color=color=red:size=640x480:rate=30",
  "-t", "10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
]);
await ensureFixture("v2-cam-blue.mp4", [
  "-f", "lavfi", "-i", "color=color=blue:size=640x480:rate=30",
  "-t", "10", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p",
]);
await ensureFixture("v2-master.wav", [
  "-f", "lavfi", "-i", "sine=f=220:d=10",
  "-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le",
]);

const [redBuf, blueBuf, audioBuf] = await Promise.all([
  readFile(path.join(FIXTURES_DIR, "v2-cam-red.mp4")),
  readFile(path.join(FIXTURES_DIR, "v2-cam-blue.mp4")),
  readFile(path.join(FIXTURES_DIR, "v2-master.wav")),
]);
const redB64 = redBuf.toString("base64");
const blueB64 = blueBuf.toString("base64");
const audioB64 = audioBuf.toString("base64");

const browser = await chromium.launch({
  headless: process.env.HEADLESS !== "0",
  args: process.env.HEADLESS === "0" ? [] : [
    "--use-gl=angle",
    "--enable-gpu-rasterization",
    "--ignore-gpu-blocklist",
  ],
});
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (m) => {
  if (m.type() === "error") consoleErrors.push(m.text());
  if (process.env.DEBUG === "1") console.error(`[browser ${m.type()}]`, m.text());
});
page.on("pageerror", (e) => { pageErrors.push(e.message); console.error("[pageerror]", e.message); });

// Seed localStorage flag BEFORE the app's module-level
// COMPOSITOR_V2_ENABLED const is evaluated. The const reads localStorage
// once per page load — SPA navigation later won't re-evaluate it. So we
// set it on the first goto and the second goto's editor mount sees it.
await page.goto(BASE + "/", { waitUntil: "domcontentloaded" });
await page.evaluate(() => window.localStorage.setItem("vasCompositor", "v2"));
const isolated = await page.evaluate(() => crossOriginIsolated && typeof SharedArrayBuffer !== "undefined");
if (!isolated) { console.error("FAIL: not crossOriginIsolated — server missing COOP/COEP?"); process.exit(2); }

const jobId = "v2smoke" + Math.random().toString(36).slice(2, 8);
await page.evaluate(async ({ jobId, redB64, blueB64, audioB64 }) => {
  function b64ToBlob(b64, mime) {
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], { type: mime });
  }
  async function dir(parent, name) { return await parent.getDirectoryHandle(name, { create: true }); }
  async function writeFile(parent, name, blob) {
    const fh = await parent.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(blob);
    await w.close();
  }
  const root = await navigator.storage.getDirectory();
  const jobsDir = await dir(root, "jobs");
  const jobDir = await dir(jobsDir, jobId);
  await writeFile(jobDir, "cam-1.mp4", b64ToBlob(redB64, "video/mp4"));
  await writeFile(jobDir, "cam-2.mp4", b64ToBlob(blueB64, "video/mp4"));
  await writeFile(jobDir, "audio.wav", b64ToBlob(audioB64, "audio/wav"));
  const dbReq = indexedDB.open("videoaudiosync", 3);
  const db = await new Promise((res, rej) => {
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
    dbReq.onsuccess = () => res(dbReq.result);
    dbReq.onerror = () => rej(dbReq.error);
  });
  const job = {
    id: jobId,
    title: "v2-smoke",
    videoFilename: "cam-red.mp4",
    audioFilename: "audio.wav",
    status: "synced",
    progress: { pct: 100, stage: "synced" },
    hasOutput: false,
    createdAt: Date.now(),
    schemaVersion: 2,
    durationS: 10,
    width: 640,
    height: 480,
    fps: 30,
    videos: [
      { kind: "video", id: "cam-1", filename: "cam-red.mp4", opfsPath: `jobs/${jobId}/cam-1.mp4`, color: "#FF0000", durationS: 10, width: 640, height: 480, fps: 30, sync: { offsetMs: 0, driftRatio: 1, confidence: 1 } },
      { kind: "video", id: "cam-2", filename: "cam-blue.mp4", opfsPath: `jobs/${jobId}/cam-2.mp4`, color: "#0000FF", durationS: 10, width: 640, height: 480, fps: 30, sync: { offsetMs: 0, driftRatio: 1, confidence: 1 } },
    ],
    cuts: [],
    sync: { offsetMs: 0, driftRatio: 1, confidence: 1 },
  };
  await new Promise((res, rej) => {
    const tx = db.transaction("jobs", "readwrite");
    tx.objectStore("jobs").put(job);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
  db.close();
}, { jobId, redB64, blueB64, audioB64 });

// Hard reload so the V2 const is re-evaluated with localStorage now seeded.
await page.goto(`${BASE}/job/${jobId}/edit?compositor=v2`, { waitUntil: "domcontentloaded" });
await page.reload({ waitUntil: "domcontentloaded" });
await page.waitForFunction(() => !document.body?.innerText?.includes("Loading editor"), null, { timeout: 15000 });

// Wait for the Compositor's canvas to mount + paint at least once.
await page.waitForTimeout(2000);

// Wait for the compositor canvas to actually have a non-trivial size
// (OutputFrameBox bootstraps async — needs at least one clip's dims to
// resolve before it gives the canvas real CSS size).
await page.waitForFunction(() => {
  const c = document.querySelector("canvas[data-vas-compositor]");
  if (!c) return false;
  const r = c.getBoundingClientRect();
  return r.width > 50 && r.height > 50;
}, null, { timeout: 8000 }).catch(() => null);

// Wait for the video pool to have loaded at least one cam and reported
// dims into the store (clip.displayW > 0). Until then the descriptor's
// `output` is null and the backend just clears.
await page.waitForFunction(() => {
  const videos = document.querySelectorAll("video");
  for (const v of videos) {
    if (v.videoWidth > 0 && v.videoHeight > 0) return true;
  }
  return false;
}, null, { timeout: 15000 }).catch(() => null);

// One more tick for the next RAF to pick up the dims.
await page.waitForTimeout(500);

const canvasDims = await page.evaluate(() => {
  const c = document.querySelector("canvas[data-vas-compositor]");
  if (!c) return null;
  const r = c.getBoundingClientRect();
  return { cssW: r.width, cssH: r.height, pixelW: c.width, pixelH: c.height };
});
console.log("[verify-v2] compositor canvas dims:", canvasDims);

// 1. Verify the V2 path actually mounted (Compositor.tsx, not MultiCamPreview).
const compositorReady = await page.evaluate(() => !!window.__vasCompositor);
if (!compositorReady) { console.error("FAIL: window.__vasCompositor missing — V2 not mounted"); await browser.close(); process.exit(3); }
console.log("[verify-v2] compositor mounted");

// Helper: sample the Compositor's canvas at a normalised UV coordinate.
// WebGL2 with preserveDrawingBuffer:false (our setting) clears the
// backbuffer after composite, so reading it from outside the same RAF
// gives zeros. We force a fresh tick + immediate sample by calling
// runtime.tick() and then drawImage'ing the result before the browser
// composites again.
async function sampleCanvas(uvX, uvY) {
  return await page.evaluate(({ uvX, uvY }) => {
    const target = document.querySelector("canvas[data-vas-compositor]");
    if (!target) return null;
    if (target.width === 0 || target.height === 0) return null;
    const r = window.__vasCompositor;
    if (r) r.tick();
    const px = Math.max(0, Math.min(target.width - 1, Math.floor(uvX * target.width)));
    const py = Math.max(0, Math.min(target.height - 1, Math.floor(uvY * target.height)));
    const off = new OffscreenCanvas(target.width, target.height);
    const ctx = off.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(target, 0, 0);
    const d = ctx.getImageData(px, py, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], a: d[3], w: target.width, h: target.height };
  }, { uvX, uvY });
}

let failed = 0;

// Force one extra wait to ensure ResizeObserver has flushed and the
// backend has been resized to the real canvas dims.
await page.waitForTimeout(500);
const runtimeBackend = await page.evaluate(() => window.__vasCompositor?.backend?.id);
console.log("[verify-v2] backend:", runtimeBackend);

// 2. Sample the centre — should be RED (cam-1 active by default, no cuts).
const centre1 = await sampleCanvas(0.5, 0.5);
console.log("[verify-v2] sample after mount (centre, expect red):", centre1);
if (!centre1) { console.error("FAIL: could not sample canvas"); await browser.close(); process.exit(4); }
if (centre1.r < 100 || centre1.g > 80 || centre1.b > 80) {
  console.error("FAIL: centre is not red");
  failed++;
}

// 3. Press '2' — switches to cam-2 (blue).
await page.keyboard.press("2");
await page.waitForTimeout(500);
const centre2 = await sampleCanvas(0.5, 0.5);
console.log("[verify-v2] sample after press 2 (centre, expect blue):", centre2);
if (centre2.b < 100 || centre2.r > 80) {
  console.error("FAIL: cut to cam-2 didn't change the rendered colour");
  failed++;
}

// 4. F-hold — vignette FX should darken the corners.
await page.keyboard.down("f");
await page.waitForTimeout(150);
const cornerWithFx = await sampleCanvas(0.02, 0.02);
const centreWithFx = await sampleCanvas(0.5, 0.5);
await page.keyboard.up("f");
console.log("[verify-v2] with F (corner / centre):", cornerWithFx, centreWithFx);
const cornerSum = cornerWithFx.r + cornerWithFx.g + cornerWithFx.b;
const centreSum = centreWithFx.r + centreWithFx.g + centreWithFx.b;
if (cornerSum >= centreSum) {
  console.error("FAIL: vignette didn't darken corners");
  failed++;
}

// 5. Errors check.
console.log("[verify-v2] consoleErrors:", consoleErrors.length, "pageErrors:", pageErrors.length);
if (pageErrors.length > 0) {
  console.error("FAIL: page errors:", pageErrors);
}
const fatalConsole = consoleErrors.filter((m) =>
  !m.includes("React Router") && !m.includes("Download the React DevTools"),
);
if (fatalConsole.length > 0) {
  console.error("FAIL: console errors:", fatalConsole);
}

// 6. Save a screenshot for the visual record.
await page.screenshot({ path: "test-fixtures/v2-smoke.png" });
console.log("[verify-v2] screenshot saved → test-fixtures/v2-smoke.png");

await browser.close();
console.log(`[verify-v2] done (${failed} failure${failed === 1 ? "" : "s"})`);
process.exit(failed === 0 ? 0 : 1);
