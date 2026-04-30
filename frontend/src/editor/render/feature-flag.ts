/**
 * Feature flag for the Phase-2 unified compositor.
 *
 * Mirrors the perf-flag pattern in `editor/perf/marks.ts`:
 *   - URL param `?compositor=v2`
 *   - localStorage `vasCompositor=v2`
 *
 * Either is enough. Resolved once per page load — flip and reload.
 * Default is OFF: V1 (`MultiCamPreview`) stays the default until the
 * parity checklist passes and the team has dogfooded V2 for a release.
 */
export function readEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    if (new URLSearchParams(window.location.search).get("compositor") === "v2") {
      return true;
    }
    return window.localStorage.getItem("vasCompositor") === "v2";
  } catch {
    return false;
  }
}

/** Re-reads URL + localStorage on every call. Use this in component
 *  bodies so the editor picks up a flag flip without requiring a hard
 *  module reload (Vite dev keeps modules across navigations, and a
 *  frozen-at-module-load const would lie). */
export function isCompositorV2Enabled(): boolean {
  return readEnabled();
}

/** Snapshot value at module load — kept exported for any caller that
 *  truly wants a one-shot read (e.g. logging at boot). Prefer
 *  `isCompositorV2Enabled()` in render paths. */
export const COMPOSITOR_V2_ENABLED: boolean = readEnabled();

/**
 * Initial backbuffer scale for the V2 preview compositor.
 *   - URL param `?compositorScale=0.75`
 *   - localStorage `vasCompositorScale=0.75`
 *
 * Manual dial only — Phase 2 doesn't ship an auto-degrader. If the
 * stress test (4 cams + 3 FX) holds 60 fps at scale=1, this stays at
 * 1 forever; if a user's GPU can't keep up, they set it lower.
 *
 * Clamped to [0.1, 2]. Returns 1 for any non-numeric / out-of-range
 * value so a typo can't render the preview unusable.
 */
export const COMPOSITOR_INITIAL_SCALE: number = readScale();

export function readScale(): number {
  if (typeof window === "undefined") return 1;
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("compositorScale");
    const fromLs = window.localStorage.getItem("vasCompositorScale");
    const raw = fromUrl ?? fromLs;
    if (raw == null) return 1;
    const n = Number(raw);
    if (!Number.isFinite(n)) return 1;
    if (n < 0.1 || n > 2) return 1;
    return n;
  } catch {
    return 1;
  }
}
