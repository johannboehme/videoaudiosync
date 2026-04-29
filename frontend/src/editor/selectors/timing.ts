/**
 * Effective timing selectors. The user can nudge the master-audio start
 * to correct a slightly-off auto-detection, pick a time signature, and
 * declare an anacrusis/pickup. Every consumer that draws the beat grid,
 * snaps to it, or jumps to the music start reads through these helpers
 * so the raw analyzer values and the user corrections are combined in
 * exactly one place.
 */
import type { JobMeta } from "../store";

const DEFAULT_BEATS_PER_BAR = 4;

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

export function effectiveBeatsPerBar(meta: JobMeta | null | undefined): number {
  const v = meta?.beatsPerBar;
  if (typeof v !== "number" || !Number.isFinite(v) || v < 1) {
    return DEFAULT_BEATS_PER_BAR;
  }
  return Math.floor(v);
}

export function effectiveBarOffsetBeats(
  meta: JobMeta | null | undefined,
): number {
  const bpb = effectiveBeatsPerBar(meta);
  const raw = meta?.barOffsetBeats;
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 0;
  // Pickup of `beatsPerBar` ≡ no pickup, so the canonical form is the
  // modular remainder. Floor before the modulo so fractional inputs (we
  // only accept integer beat counts in the UI, but be safe) collapse
  // deterministically.
  const m = Math.floor(raw) % bpb;
  return m < 0 ? m + bpb : m;
}

/** Where bar 1 / beat 1 sits on the master timeline, in seconds.
 *  Returns 0 when bpm is unknown (no period to shift by). */
export function effectiveBarPhaseS(meta: JobMeta | null | undefined): number {
  const bpm = meta?.bpm?.value;
  if (!bpm || bpm <= 0) return 0;
  const beatPeriod = 60 / bpm;
  return (
    effectiveBeatPhaseS(meta) +
    effectiveBarOffsetBeats(meta) * beatPeriod
  );
}
