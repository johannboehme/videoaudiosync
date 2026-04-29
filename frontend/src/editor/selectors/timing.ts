/**
 * Effective timing selectors. The user can nudge the master-audio start
 * to correct a slightly-off auto-detection. The nudge lives in
 * `JobMeta.audioStartNudgeS` (separate from the analyzer baseline so
 * re-analysis doesn't clobber it). Every consumer that draws the beat
 * grid, snaps to the grid, or jumps to the music start reads through
 * these helpers — they're the single choke point that turns the raw
 * analyzer values into the user-corrected ones.
 */
import type { JobMeta } from "../store";

export function effectiveBeatPhaseS(meta: JobMeta | null | undefined): number {
  const phase = meta?.bpm?.phase ?? 0;
  const nudge = meta?.audioStartNudgeS ?? 0;
  return phase + nudge;
}

export function effectiveAudioStartS(meta: JobMeta | null | undefined): number {
  const start = meta?.audioStartS ?? 0;
  const nudge = meta?.audioStartNudgeS ?? 0;
  return start + nudge;
}
