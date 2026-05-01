// One-shot script that drives a real Chromium and captures the README screenshots.
// Uses the bundled test fixtures to create a real synced job, then walks every panel.
// Used only for repo asset generation; not part of the build.
import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, "..", "..", ".github", "screenshots");
await mkdir(outDir, { recursive: true });

const fixtures = resolve(here, "..", "public", "__test_fixtures__");
const audioPath = join(fixtures, "studio-mp3.mp3");
const videoPaths = [
  join(fixtures, "video-720p.mp4"),
  join(fixtures, "video-1080p.mp4"),
  join(fixtures, "video-portrait-1080.mp4"),
];

const base = process.env.VAS_BASE_URL ?? "http://localhost:5173";

const browser = await chromium.launch({
  args: ["--enable-features=SharedArrayBuffer"],
});
// PNGs are kept ≤ 2000 px on the long side so chat tools that have an
// image-dimension cap can read them. Viewport drives PNG width directly
// when deviceScaleFactor = 1.
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});

// The first-install PWA overlay sits on top of every page until the service
// worker reports offlineReady. In dev that never fires (PWA is gated off);
// in preview it can take ~minutes to download the precache. Either way it
// blocks our automation, and we don't want it in the README anyway.
await ctx.addInitScript(() => {
  const css = '[aria-label*="Installing TK-1"]{display:none !important}';
  const apply = () => {
    const s = document.createElement("style");
    s.textContent = css;
    (document.head ?? document.documentElement).appendChild(s);
  };
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", apply, { once: true });
  } else {
    apply();
  }
});

const page = await ctx.newPage();

async function shot(path, { wait = 600 } = {}) {
  await page.waitForTimeout(wait);
  await page.screenshot({ path: join(outDir, path), type: "png", fullPage: false });
  console.log("✓", path);
}

async function gotoShot(path, url, opts) {
  await page.goto(`${base}${url}`, { waitUntil: "networkidle" });
  await shot(path, opts);
}

// ─── empty pages ───────────────────────────────────────────────────────────
await gotoShot("01-upload.png", "/");

// ─── upload + sync to create a real job ────────────────────────────────────
console.log("uploading fixtures…");
await page.setInputFiles("#picker-audio", audioPath);
await page.setInputFiles("#picker-videos", videoPaths);
await page.waitForTimeout(300);
await page.getByRole("button", { name: /sync.*open editor/i }).click();

// Wait for sync to complete — JobPage renders quick-render/open-editor buttons.
console.log("waiting for sync…");
await page.waitForURL(/\/job\/[^/]+$/, { timeout: 30_000 });
await page.waitForSelector("text=/quick render/i", { timeout: 30_000 });
const jobUrl = page.url();
const jobId = jobUrl.match(/\/job\/([^/?#]+)/)[1];
console.log("synced →", jobId);

// History (now has one job)
await gotoShot("02-jobs.png", "/jobs");

// Job detail (sync results)
await gotoShot("03-job-detail.png", `/job/${jobId}`);

// Editor — sync tuner with knob (after picking CAM 1)
await page.goto(`${base}/job/${jobId}/edit`, { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.getByRole("button", { name: /^cam 1$/i }).first().click().catch(() => {});
await shot("04-editor-sync.png", { wait: 600 });

// Options
await page.getByRole("tab", { name: /options/i }).click().catch(() => {});
await shot("05-editor-options.png", { wait: 500 });

// Overlays
await page.getByRole("tab", { name: /overlays/i }).click().catch(() => {});
await shot("06-editor-overlays.png", { wait: 500 });

// Export
await page.getByRole("tab", { name: /export/i }).click().catch(() => {});
await shot("07-editor-export.png", { wait: 500 });

// Help overlay (Shift+/ -> "?")
await page.locator("body").click({ position: { x: 400, y: 400 } });
await page.keyboard.press("Shift+/");
await shot("08-editor-help.png", { wait: 500 });
await page.keyboard.press("Escape");

// Settings
await gotoShot("09-settings.png", "/settings");

await browser.close();
console.log("Done →", outDir);
