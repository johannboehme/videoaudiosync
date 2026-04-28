// End-to-end smoke + sync inspection.
// Drives the dev server at localhost:5173 with two scenarios:
//   1. Single cam:  side_a.wav + 20260425_221418_8ef1ebd4.mp4
//   2. Multi cam:   side_b.wav + try2handy.mp4 + try2meta.mp4
// After each upload, waits for sync, dumps the IDB job record, and reports
// what the SyncPatchPanel would show.

import { chromium } from "playwright";
import { join } from "node:path";

const DOWNLOADS = "/Users/devien/Downloads";
const BASE = "http://localhost:5174";

function f(name) {
  return join(DOWNLOADS, name);
}

const SCENARIOS = [
  {
    name: "single-cam",
    audio: f("side_a.wav"),
    videos: [f("20260425_221418_8ef1ebd4.mp4")],
  },
  {
    name: "multi-cam",
    audio: f("side_b.wav"),
    videos: [f("try2handy.mp4"), f("try2meta.mp4")],
  },
];

async function dumpIdb(page) {
  return await page.evaluate(async () => {
    const req = indexedDB.open("videoaudiosync");
    await new Promise((r) => (req.onsuccess = r));
    const tx = req.result.transaction("jobs");
    const all = await new Promise(
      (r) => (tx.objectStore("jobs").getAll().onsuccess = (e) => r(e.target.result)),
    );
    return all.map((j) => ({
      id: j.id,
      status: j.status,
      schemaVersion: j.schemaVersion,
      videoFilename: j.videoFilename,
      audioFilename: j.audioFilename,
      topSync: j.sync,
      videoCount: j.videos?.length,
      videos: j.videos?.map((v) => ({
        id: v.id,
        filename: v.filename,
        opfsPath: v.opfsPath,
        sync: v.sync,
        durationS: v.durationS,
      })),
      cuts: j.cuts,
    }));
  });
}

async function wipeIdb(page) {
  await page.evaluate(async () => {
    const dbs = await indexedDB.databases();
    for (const d of dbs) {
      await new Promise((r) => {
        const req = indexedDB.deleteDatabase(d.name);
        req.onsuccess = req.onerror = req.onblocked = r;
      });
    }
    if ("storage" in navigator) {
      const root = await navigator.storage.getDirectory();
      for await (const [name] of root.entries()) {
        await root.removeEntry(name, { recursive: true }).catch(() => {});
      }
    }
  });
}

async function runScenario(page, scenario) {
  console.log(`\n=== Scenario: ${scenario.name} ===`);

  await page.goto(BASE + "/");
  await page.waitForLoadState("networkidle");

  // Navigate to upload
  await page.goto(BASE + "/upload");
  await page.waitForLoadState("networkidle");

  // Wipe IDB + OPFS to start clean
  await wipeIdb(page);
  console.log(`[${scenario.name}] wiped IDB + OPFS`);

  // Reload so the app rebuilds its DB at the right version
  await page.reload();
  await page.waitForLoadState("networkidle");

  // New Upload UI: one #picker-audio + one #picker-videos with multi-select.
  await page.locator("#picker-audio").setInputFiles(scenario.audio);
  await page.locator("#picker-videos").setInputFiles(scenario.videos);

  // Debug: dump page state
  await page.screenshot({ path: `/tmp/vas-${scenario.name}.png`, fullPage: true });
  const buttons = await page.locator("button").allTextContents();
  console.log(`[${scenario.name}] buttons:`, buttons);

  // Submit
  await page
    .getByRole("button", { name: /sync.*open editor/i })
    .click({ timeout: 5000 });
  console.log(`[${scenario.name}] submitted`);

  // Wait for navigation to /job/...
  await page.waitForURL(/\/job\/[a-f0-9]+/, { timeout: 30000 });
  console.log(`[${scenario.name}] navigated to:`, page.url());

  // Poll IDB until status === synced (or timeout). Logs every status change
  // and every progress.pct so we can see where things hang.
  const t0 = Date.now();
  let lastStatus = null;
  let lastPct = -1;
  while (Date.now() - t0 < 600_000) {
    const jobs = await dumpIdb(page);
    if (jobs.length > 0) {
      const cur = jobs[jobs.length - 1];
      // Also pull progress separately
      const progress = await page.evaluate(async () => {
        const req = indexedDB.open("videoaudiosync");
        await new Promise((r) => (req.onsuccess = r));
        const tx = req.result.transaction("jobs");
        const all = await new Promise(
          (r) => (tx.objectStore("jobs").getAll().onsuccess = (e) => r(e.target.result)),
        );
        return all[all.length - 1]?.progress;
      });
      if (cur.status !== lastStatus) {
        console.log(`[${scenario.name}] status: ${cur.status} progress=${JSON.stringify(progress)}`);
        lastStatus = cur.status;
      } else if (progress?.pct !== lastPct) {
        console.log(`[${scenario.name}] progress: ${JSON.stringify(progress)}`);
        lastPct = progress?.pct;
      }
      if (cur.status === "synced" || cur.status === "failed") {
        return { scenario: scenario.name, finalJob: cur, allJobs: jobs };
      }
    }
    await page.waitForTimeout(1000);
  }
  throw new Error(`[${scenario.name}] timed out waiting for sync`);
}

async function inspectJobPage(page, jobId) {
  // Navigate to the job page and read what the user actually sees
  await page.goto(`${BASE}/job/${jobId}`);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(500);

  // Read all text from the page so we can grep for "—" / "Sync" / readouts
  const snapshot = await page.evaluate(() => document.body.innerText);
  return snapshot;
}

async function runEditorChecks(page, jobId, label) {
  console.log(`\n--- editor checks: ${label} ---`);
  await page.goto(`${BASE}/job/${jobId}/edit`, { waitUntil: "domcontentloaded" });
  // Editor mounts a few async resources (waveform, frames image). Give it a bit.
  await page.waitForTimeout(4000);

  // Snapshot the editor.
  await page.screenshot({ path: `/tmp/vas-${label}-editor.png`, fullPage: true });

  // Verify timeline pieces are in the DOM.
  const text = await page.evaluate(() => document.body.innerText);
  const hasPanel = /PROGRAM/i.test(text);
  const hasMaster = /MASTER · AUDIO/i.test(text);
  const hasCam = /CAM 1/i.test(text);
  const hasSyncTuner = /SYNC\s*TUNER|Sync · Cam/i.test(text);
  console.log(
    `[${label}] editor: PROGRAM=${hasPanel} MASTER=${hasMaster} CAM=${hasCam} SYNC_TUNER=${hasSyncTuner}`,
  );

  // Hotkey cut test (1 → cam-1, 2 → cam-2 if present).
  await page.keyboard.press("1");
  await page.waitForTimeout(200);
  await page.keyboard.press("2");
  await page.waitForTimeout(200);

  // The editor's `addCut` mutates an in-memory zustand slice that's only
  // persisted on render-submit — to verify the hotkey reached the right
  // place we check that pressing 1/2 didn't crash and the page is alive.
  const stillAlive = await page.evaluate(
    () => document.querySelector("body")?.children.length ?? 0,
  );
  console.log(`[${label}] editor still alive after hotkeys: ${stillAlive > 0}`);

  return { hasPanel, hasMaster, hasCam, hasSyncTuner };
}

async function runRenderCheck(page, jobId, label) {
  console.log(`\n--- render check: ${label} ---`);
  await page.goto(`${BASE}/job/${jobId}`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  // Click QUICK RENDER (single-source pipeline) — quickest path to verify
  // the encoder + muxer actually produce a file.
  await page.getByRole("button", { name: /quick render/i }).click();

  const t0 = Date.now();
  let lastStatus = null;
  while (Date.now() - t0 < 600_000) {
    const job = await page.evaluate(async () => {
      const req = indexedDB.open("videoaudiosync");
      await new Promise((r) => (req.onsuccess = r));
      const tx = req.result.transaction("jobs");
      const all = await new Promise(
        (r) => (tx.objectStore("jobs").getAll().onsuccess = (e) => r(e.target.result)),
      );
      return all[all.length - 1];
    });
    if (job?.status !== lastStatus) {
      console.log(
        `[render-${label}] status=${job?.status} progress=${JSON.stringify(job?.progress)}`,
      );
      lastStatus = job?.status;
    }
    if (job?.status === "rendered") {
      console.log(
        `[render-${label}] DONE: bytes=${job.outputBytes}, hasOutput=${job.hasOutput}`,
      );
      return { ok: true, bytes: job.outputBytes };
    }
    if (job?.status === "failed") {
      console.log(`[render-${label}] FAILED: ${job.error}`);
      return { ok: false, error: job.error };
    }
    await page.waitForTimeout(1500);
  }
  return { ok: false, error: "timeout" };
}

async function runHistoryChecks(page) {
  console.log(`\n--- history page check ---`);
  await page.goto(`${BASE}/jobs`, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);
  const text = await page.evaluate(() => document.body.innerText);
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  console.log(`[history] visible lines:`, lines.slice(0, 20));
}

async function runStaticPageChecks(page, paths) {
  for (const p of paths) {
    await page.goto(BASE + p, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(300);
    const titles = await page.locator("h1, h2").allTextContents();
    console.log(`[static] ${p}: titles=${JSON.stringify(titles)}`);
  }
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.log(`[console.${msg.type()}]`, msg.text());
    }
  });
  page.on("pageerror", (err) => console.log("[pageerror]", err.message));
  page.on("requestfailed", (req) =>
    console.log("[reqfail]", req.url(), req.failure()?.errorText),
  );

  try {
    for (const scenario of SCENARIOS) {
      const result = await runScenario(page, scenario);
      console.log(
        `\n[${result.scenario}] FINAL JOB:\n`,
        JSON.stringify(result.finalJob, null, 2),
      );

      const pageText = await inspectJobPage(page, result.finalJob.id);
      console.log(`\n[${result.scenario}] JOB PAGE TEXT:\n${pageText}`);

      // Smoke-check the editor: opens, shows the timeline, hotkeys reach it.
      await runEditorChecks(page, result.finalJob.id, result.scenario);

      // Trigger a quick render and verify the MP4 actually lands.
      const renderResult = await runRenderCheck(page, result.finalJob.id, result.scenario);
      console.log(`[${result.scenario}] render result:`, renderResult);
    }

    // History page should show all the jobs from above.
    await runHistoryChecks(page);

    // Static pages.
    await runStaticPageChecks(page, ["/impressum", "/datenschutz", "/settings"]);
  } catch (err) {
    console.error("ERROR:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
