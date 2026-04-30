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
function readEnabled(): boolean {
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

export const COMPOSITOR_V2_ENABLED: boolean = readEnabled();
