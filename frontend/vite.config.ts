/// <reference types="vitest" />
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// COOP/COEP-Header sind Pflicht für SharedArrayBuffer und damit für
// WASM-Threads und ffmpeg.wasm. Sie werden im Dev-Server (hier) und im
// Production-nginx (nginx.conf) gesetzt — beides muss übereinstimmen, sonst
// crossOriginIsolated === false.
const crossOriginIsolationHeaders = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig({
  // Read .env / .env.local from the repo root, not from frontend/. The
  // root is where docker-compose.yml lives, and we want a single source of
  // truth for both `npm run dev` (here) and the Docker build (which reads
  // the same .env to populate VITE_* build args).
  envDir: "..",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,ico,woff2,wasm}"],
        // Precache ffmpeg-core (~62 MB für UMD+ESM Varianten); je File ~31 MB,
        // Workbox-Default-Limit ist 2 MiB → muss hoch.
        globIgnores: ["**/__test_fixtures__/**"],
        maximumFileSizeToCacheInBytes: 64 * 1024 * 1024,
        navigateFallback: "/index.html",
        navigateFallbackDenylist: [/^\/ffmpeg-core/],
      },
      manifest: {
        name: "TK-1 — Take One",
        short_name: "TK-1",
        description:
          "Multi-cam music video editor — audio is master, every angle aligns.",
        theme_color: "#FAF6EC",
        background_color: "#FAF6EC",
        display: "standalone",
        start_url: "/",
        scope: "/",
        lang: "en",
        icons: [
          { src: "/pwa-icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/pwa-icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
          { src: "/favicon.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
      // SW im Dev aus — sonst kollidiert er mit Vite-HMR und der COOP/COEP-
      // Iteration. Verifikation läuft über `npm run build && npm run preview`.
      devOptions: { enabled: false },
    }),
  ],
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
