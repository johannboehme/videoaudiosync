/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// COOP/COEP-Header sind Pflicht für SharedArrayBuffer und damit für
// WASM-Threads und ffmpeg.wasm. Sie werden im Dev-Server (hier) und im
// Production-nginx (nginx.conf) gesetzt — beides muss übereinstimmen, sonst
// crossOriginIsolated === false.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ["mp4box", "mp4-muxer", "idb"],
    // ffmpeg.wasm spawns its own worker via
    // `new Worker(new URL('./worker.js', import.meta.url))`. The dep
    // optimizer flattens the directory layout and breaks those paths;
    // excluding lets Vite serve the package as-is so the runtime URL
    // resolution finds the worker file where the package expects it.
    // jassub stays in the optimizer (it has many transitive deps) but
    // we explicitly bundle its worker via `?worker&url` in compositor.ts.
    exclude: ["@ffmpeg/ffmpeg", "@ffmpeg/util"],
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
  // sync.worker.ts dynamically imports the wasm-pack output, which forces
  // code-splitting inside the worker bundle. Vite's default worker format
  // is "iife", which Rollup rejects for code-split outputs. ESM workers
  // are fine here — both workers are instantiated with { type: "module" }.
  worker: {
    format: "es",
  },
  server: {
    headers: crossOriginIsolationHeaders,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test-setup.ts"],
    css: false,
  },
});
