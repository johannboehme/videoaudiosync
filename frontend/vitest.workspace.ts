import { defineWorkspace } from "vitest/config";

/**
 * Zwei Test-Modi (siehe ../TESTING.md):
 *
 *   1. unit  — vitest in jsdom für Pure-Function- und Component-Tests.
 *              Schnell, läuft überall, keine echten Browser-APIs.
 *
 *   2. browser — vitest mit echtem Chromium (über Playwright Provider) für
 *                Browser-API-Integrationen: OPFS, IndexedDB, WebCodecs, WASM-
 *                Threads, Web Workers. Tests heißen `*.browser.test.ts`.
 *
 * Beide Workspaces erben den Root-vite.config.ts (insb. den React-Plugin und
 * COOP/COEP-Header), so dass `crossOriginIsolated === true` auch im Browser-
 * Test gilt.
 */
export default defineWorkspace([
  {
    extends: "./vite.config.ts",
    test: {
      name: "unit",
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test-setup.ts"],
      include: ["src/**/*.test.{ts,tsx}"],
      exclude: ["src/**/*.browser.test.{ts,tsx}"],
      css: false,
    },
  },
  {
    extends: "./vite.config.ts",
    test: {
      name: "browser",
      include: ["src/**/*.browser.test.{ts,tsx}"],
      browser: {
        enabled: true,
        provider: "playwright",
        headless: true,
        name: "chromium",
      },
    },
  },
]);
