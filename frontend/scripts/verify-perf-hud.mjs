// Smoke-check: open the dev server with ?perf=1 in a real Chromium,
// verify cross-origin isolation actually unlocks SharedArrayBuffer,
// confirm there are no console errors, and confirm the PerfHUD mounts.
//
// Usage: node scripts/verify-perf-hud.mjs [url]
// Requires the dev server to be running (npm run dev).

import { chromium } from "playwright";

const TARGET_URL = process.argv[2] ?? "http://localhost:5174/?perf=1";

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext();
const page = await ctx.newPage();

const consoleErrors = [];
const pageErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (err) => pageErrors.push(err.message));

await page.goto(TARGET_URL, { waitUntil: "networkidle" });

const landing = await page.evaluate(() => ({
  title: document.title,
  crossOriginIsolated: typeof crossOriginIsolated !== "undefined" ? crossOriginIsolated : null,
  hasSAB: typeof SharedArrayBuffer !== "undefined",
  href: window.location.href,
  bodyText: document.body?.innerText?.slice(0, 200) ?? "",
  routerPath: window.location.pathname,
}));

// Also navigate to the editor route with a non-existent id. The route
// should mount cleanly — it will show its own "loading / not found"
// state but must not throw a render-time error from our changes.
const editorUrl = new URL(TARGET_URL);
editorUrl.pathname = "/job/__perf_smoke__/edit";
await page.goto(editorUrl.toString(), { waitUntil: "networkidle" });

const editor = await page.evaluate(() => ({
  routerPath: window.location.pathname,
  bodyText: document.body?.innerText?.slice(0, 400) ?? "",
  // The PerfHUD is a fixed-position panel with mono font + the unique
  // "PERF · last" header.
  perfHudPresent: !!document.body?.innerText?.includes("PERF · last"),
}));

console.log(JSON.stringify({ landing, editor, consoleErrors, pageErrors }, null, 2));

await browser.close();
