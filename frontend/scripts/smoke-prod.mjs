/**
 * Production smoke test: load the public URL in a real headless Chromium
 * and assert the page renders, COOP/COEP headers are set, capability
 * report shows all green, and the Settings page reports the right path.
 *
 * Run with: node scripts/smoke-prod.mjs https://sync.johannboehme.de
 */

import { chromium } from "playwright";

const URL = process.argv[2] ?? "https://sync.johannboehme.de";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

function pass(msg) {
  console.log(`✓ ${msg}`);
}

async function main() {
  console.log(`Smoke test → ${URL}\n`);
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    const consoleErrors = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    // 1. The page loads with HTTP 200 and the right COOP/COEP headers.
    const resp = await page.goto(URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!resp) return fail("no response from server");
    if (resp.status() !== 200) return fail(`expected 200, got ${resp.status()}`);
    pass(`HTTP ${resp.status()} from ${URL}`);

    const headers = resp.headers();
    const coop = headers["cross-origin-opener-policy"];
    const coep = headers["cross-origin-embedder-policy"];
    if (coop === "same-origin") pass(`COOP: ${coop}`);
    else fail(`COOP missing/wrong: ${coop ?? "(none)"}`);
    if (coep === "require-corp") pass(`COEP: ${coep}`);
    else fail(`COEP missing/wrong: ${coep ?? "(none)"}`);

    // 2. After hydration, the upload page should be visible.
    await page.waitForLoadState("networkidle", { timeout: 20000 });
    const dropZoneText = await page
      .locator("text=Drop video.")
      .first()
      .textContent({ timeout: 10000 });
    if (dropZoneText) pass(`upload page rendered ("${dropZoneText.trim()}")`);
    else fail("upload page did not render");

    // 3. crossOriginIsolated must be true in the rendered page.
    const isolated = await page.evaluate(() => globalThis.crossOriginIsolated);
    if (isolated === true) pass("crossOriginIsolated === true");
    else fail(`crossOriginIsolated === ${isolated}`);

    // 4. Settings page: capability report must show every flag green.
    await page.goto(`${URL.replace(/\/$/, "")}/settings`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector('[data-testid="render-path"]', { timeout: 10000 });
    const renderPath = await page
      .locator('[data-testid="render-path"]')
      .textContent();
    pass(`render path: ${renderPath?.trim().replace(/\s+/g, " ")}`);

    const minStatus = await page
      .locator('[data-testid="min-status"]')
      .textContent();
    if (minStatus && /Ready/i.test(minStatus)) pass(`status: ${minStatus.trim().replace(/\s+/g, " ")}`);
    else fail(`status not ready: ${minStatus}`);

    // 5. Per-capability checks. We expect at least the four min requirements
    //    plus WebCodecs full surface in headless Chromium.
    const expectedTrue = [
      "webAssembly",
      "sharedArrayBuffer",
      "crossOriginIsolated",
      "opfs",
      "audioDecoder",
      "videoDecoder",
      "audioEncoder",
      "videoEncoder",
    ];
    for (const cap of expectedTrue) {
      const cell = await page.locator(`[data-testid="cap-${cap}"]`).textContent();
      if (cell && cell.includes("✓")) pass(`cap ${cap}: ✓`);
      else fail(`cap ${cap}: ${cell?.trim() ?? "(missing)"}`);
    }

    if (consoleErrors.length > 0) {
      console.log("\nConsole/page errors:");
      for (const e of consoleErrors.slice(0, 10)) console.log(`  - ${e}`);
      // Don't fail on console errors alone — production may have benign ones.
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Smoke test crashed:", err);
  process.exit(2);
});
