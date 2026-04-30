// Run bench-press-to-paint.mjs N times, aggregate per-metric samples,
// print median p50/p95/max so noise from any single run averages out.
// Uses HEADLESS env var to control mode.

import { spawnSync } from "node:child_process";

const N = +(process.env.RUNS ?? 5);
const all = {};
for (let i = 1; i <= N; i++) {
  process.stderr.write(`[run ${i}/${N}] `);
  const r = spawnSync("node", ["scripts/bench-press-to-paint.mjs"], {
    env: { ...process.env, JSON: "1" },
    encoding: "utf8",
  });
  if (r.status !== 0) {
    process.stderr.write(`FAILED\n${r.stderr}\n`);
    continue;
  }
  // Find the JSON line in stdout (last non-empty line).
  const line = r.stdout.trim().split("\n").filter(Boolean).pop();
  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch {
    process.stderr.write(`unparsable\n`);
    continue;
  }
  for (const [kind, b] of Object.entries(parsed.result || {})) {
    if (!all[kind]) all[kind] = [];
    all[kind].push(...(b.samples || []));
  }
  process.stderr.write(`ok\n`);
}

function pct(s, p) {
  if (s.length === 0) return 0;
  const sorted = [...s].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

const out = {};
for (const [kind, samples] of Object.entries(all)) {
  out[kind] = {
    n: samples.length,
    p50: +pct(samples, 0.5).toFixed(2),
    p95: +pct(samples, 0.95).toFixed(2),
    p99: +pct(samples, 0.99).toFixed(2),
    max: samples.length ? +Math.max(...samples).toFixed(2) : 0,
  };
}
console.log(JSON.stringify({ runs: N, headless: process.env.HEADLESS !== "0", aggregated: out }, null, 2));
