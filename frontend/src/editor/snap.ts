/**
 * Pure snap helper. Used by every drag handler in the timeline (playhead,
 * cam-clip move, trim handles, cut-set) so snap behaviour is consistent
 * regardless of *how* the user changes a time value.
 *
 * 4/4 is fixed in V1; "1" = whole bar = 4 beats. The grid is anchored at
 * `beatPhase` so a detected beat-1 offset shifts every other tick along
 * with it.
 */

export type SnapMode = "off" | "match" | "1" | "1/2" | "1/4" | "1/8" | "1/16";

export interface SnapCtx {
  /** BPM as detected (or user-overridden). null disables grid modes. */
  bpm: number | null;
  /** Time of beat 0 in seconds. Grid lines = beatPhase + n * step. */
  beatPhase: number;
  /** When in "match" mode, the candidate positions in master-timeline
   *  seconds that the cursor should snap to. */
  candidatePositions?: number[];
  /** Snap threshold for "match" mode (seconds). Default 0.25 s — generous
   *  so the user finds the candidate even with shaky pointer movement. */
  matchThresholdS?: number;
}

const DEFAULT_MATCH_THRESHOLD_S = 0.25;

/** Convert a SnapMode to its grid-step length in seconds, or null if the
 *  mode doesn't define a fixed step (off / match). */
export function gridStepSeconds(mode: SnapMode, bpm: number | null): number | null {
  if (!bpm || bpm <= 0) return null;
  const beatS = 60 / bpm;
  switch (mode) {
    case "1":
      return beatS * 4; // whole bar = 4 beats (4/4)
    case "1/2":
      return beatS * 2;
    case "1/4":
      return beatS;
    case "1/8":
      return beatS / 2;
    case "1/16":
      return beatS / 4;
    default:
      return null;
  }
}

/** Snap a time `t` (seconds) to the active grid / candidate set. */
export function snapTime(t: number, mode: SnapMode, ctx: SnapCtx): number {
  if (mode === "off") return t;

  if (mode === "match") {
    const list = ctx.candidatePositions;
    if (!list || list.length === 0) return t;
    const thr = ctx.matchThresholdS ?? DEFAULT_MATCH_THRESHOLD_S;
    let best = t;
    let bestDist = thr;
    for (const c of list) {
      const d = Math.abs(c - t);
      if (d < bestDist) {
        bestDist = d;
        best = c;
      }
    }
    return best;
  }

  // Grid modes.
  const step = gridStepSeconds(mode, ctx.bpm);
  if (step === null) return t;
  const phase = ctx.beatPhase ?? 0;
  const k = Math.round((t - phase) / step);
  return phase + k * step;
}
