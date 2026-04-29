/**
 * Pure helper: produce ruler-tick positions for a given BPM, phase, and
 * visible time-range. Subdivisions appear/hide based on the zoom level
 * (px-per-beat) so the ruler stays legible at every zoom.
 *
 * `beatsPerBar` (default 4) controls how many beats live in one bar.
 * `barOffsetBeats` (default 0) shifts where bar 1 begins — for songs
 * with an anacrusis / pickup the first N beats render as `beat` ticks
 * and bar 1 starts on the (N+1)th detected beat.
 */

export type RulerTickKind = "bar" | "beat" | "div8" | "div16";

export interface RulerTick {
  /** Time in seconds on the master timeline. */
  t: number;
  kind: RulerTickKind;
  /** 1-based bar number, only set on `bar` ticks. */
  barNumber?: number;
}

const DEFAULT_BEATS_PER_BAR = 4;

const MIN_PX_PER_BEAT_FOR_BEATS = 8;
const MIN_PX_PER_BEAT_FOR_DIV8 = 32;
const MIN_PX_PER_BEAT_FOR_DIV16 = 64;

export interface BuildRulerTicksOpts {
  bpm: number | null;
  beatPhase: number;
  startS: number;
  endS: number;
  pxPerSec: number;
  /** Beats per bar — default 4. */
  beatsPerBar?: number;
  /** Anacrusis / pickup, in beats. Default 0. The first N beats after the
   *  phase render as `beat` ticks; bar 1 starts at beat N. */
  barOffsetBeats?: number;
}

export function buildRulerTicks(opts: BuildRulerTicksOpts): RulerTick[] {
  const {
    bpm,
    beatPhase,
    startS,
    endS,
    pxPerSec,
    beatsPerBar = DEFAULT_BEATS_PER_BAR,
    barOffsetBeats = 0,
  } = opts;
  if (!bpm || bpm <= 0 || endS <= startS) return [];

  const bpb = beatsPerBar > 0 ? Math.floor(beatsPerBar) : DEFAULT_BEATS_PER_BAR;
  // Canonicalise the offset into [0, bpb) — pickup of `bpb` ≡ no pickup.
  let off = Math.floor(barOffsetBeats) % bpb;
  if (off < 0) off += bpb;

  const beatS = 60 / bpm;
  const pxPerBeat = beatS * pxPerSec;

  const showBeats = pxPerBeat >= MIN_PX_PER_BEAT_FOR_BEATS;
  const showDiv8 = pxPerBeat >= MIN_PX_PER_BEAT_FOR_DIV8;
  const showDiv16 = pxPerBeat >= MIN_PX_PER_BEAT_FOR_DIV16;

  const ticks: RulerTick[] = [];

  // Iterate from the first beat at-or-before startS up to endS. We clamp
  // to >= 0 so the silent intro before beatPhase stays empty (no negative
  // bars hovering in the dead air).
  const firstBeatIdx = Math.max(0, Math.floor((startS - beatPhase) / beatS));
  const lastBeatIdx = Math.ceil((endS - beatPhase) / beatS);

  for (let i = firstBeatIdx; i <= lastBeatIdx; i++) {
    const beatT = beatPhase + i * beatS;
    if (beatT < startS - 1e-9 || beatT > endS + 1e-9) continue;

    // `j` = beat index relative to bar 1 / beat 1. Pickup beats sit at
    // j < 0 (we render them as `beat` ticks) and bar starts are at
    // j = 0, bpb, 2*bpb, …
    const j = i - off;
    const isBarStart = j >= 0 && j % bpb === 0;
    if (isBarStart) {
      const barNumber = j / bpb + 1;
      ticks.push({ t: beatT, kind: "bar", barNumber });
    } else if (showBeats) {
      ticks.push({ t: beatT, kind: "beat" });
    }

    if (showDiv8) {
      const halfT = beatT + beatS / 2;
      if (halfT >= startS - 1e-9 && halfT <= endS + 1e-9) {
        ticks.push({ t: halfT, kind: "div8" });
      }
    }
    if (showDiv16) {
      const q1 = beatT + beatS / 4;
      const q3 = beatT + (3 * beatS) / 4;
      if (q1 >= startS - 1e-9 && q1 <= endS + 1e-9) {
        ticks.push({ t: q1, kind: "div16" });
      }
      if (q3 >= startS - 1e-9 && q3 <= endS + 1e-9) {
        ticks.push({ t: q3, kind: "div16" });
      }
    }
  }
  ticks.sort((a, b) => a.t - b.t);
  return ticks;
}
