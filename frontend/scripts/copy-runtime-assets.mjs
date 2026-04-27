/**
 * Copies the ffmpeg.wasm runtime files (single-threaded core + ESM core)
 * out of node_modules into public/ffmpeg-core/ at install time. Vite
 * serves /public verbatim, so the runtime can fetch them via toBlobURL
 * without dealing with bundler quirks.
 *
 * Runs as `postinstall` so a fresh `npm ci` in CI / Docker is enough to
 * make a build work without checking the WASM blobs into git.
 */
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "..");
const out = join(repoRoot, "public", "ffmpeg-core");

mkdirSync(out, { recursive: true });

const sources = [
  ["node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.js", "ffmpeg-core.js"],
  ["node_modules/@ffmpeg/core/dist/umd/ffmpeg-core.wasm", "ffmpeg-core.wasm"],
  ["node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js", "ffmpeg-core-esm.js"],
  ["node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm", "ffmpeg-core-esm.wasm"],
];

for (const [rel, dest] of sources) {
  const src = join(repoRoot, rel);
  if (!existsSync(src)) {
    console.warn(`[copy-runtime-assets] missing source: ${rel}`);
    continue;
  }
  copyFileSync(src, join(out, dest));
}
console.log(`[copy-runtime-assets] copied ffmpeg core files → public/ffmpeg-core/`);
