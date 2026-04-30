/**
 * Compositor configuration knobs read from URL params / localStorage.
 *
 * Mirrors the perf-flag pattern in `editor/perf/marks.ts` — flip and
 * reload. Currently exposes the resolution-scale dial; further knobs
 * (e.g. forced backend selection) can drop in here.
 */

/**
 * Initial backbuffer scale for the preview compositor.
 *   - URL param `?compositorScale=0.75`
 *   - localStorage `vasCompositorScale=0.75`
 *
 * Manual dial only — the compositor doesn't ship an auto-degrader.
 * Stress-tested defaults stay at 1.0; users on slower GPUs set it lower.
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
