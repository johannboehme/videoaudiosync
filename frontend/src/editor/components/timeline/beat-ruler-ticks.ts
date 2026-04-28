/**
 * Pure helper: produce ruler-tick positions for a given BPM, phase, and
 * visible time-range. Subdivisions appear/hide based on the zoom level
 * (px-per-beat) so the ruler stays legible at every zoom.
 *
 * 4/4 fixed in V1: a "bar" = 4 beats. The ruler treats `beatPhase` as
 * beat 0 of bar 1.
 */

export type RulerTickKind = "bar" | "beat" | "div8" | "div16";

export interface RulerTick {
  /** Time in seconds on the master timeline. */
  t: number;
  kind: RulerTickKind;
  /** 1-based bar number, only set on `bar` ticks. */
  barNumber?: number;
}

const BEATS_PER_BAR = 4;

// Density thresholds in px-per-beat. Below 8 px/beat the beats blur into
// the bars; below 32 px/beat the 1/8 subdivisions become hairline; below
// 64 px/beat the 1/16s become indistinguishable. These cuts keep the
// ruler from turning into solid grey at any zoom.
const MIN_PX_PER_BEAT_FOR_BEATS = 8;
const MIN_PX_PER_BEAT_FOR_DIV8 = 32;
const MIN_PX_PER_BEAT_FOR_DIV16 = 64;

export interface BuildRulerTicksOpts {
  bpm: number | null;
  beatPhase: number;
  startS: number;
  endS: number;
  pxPerSec: number;
}

export function buildRulerTicks(opts: BuildRulerTicksOpts): RulerTick[] {
  const { bpm, beatPhase, startS, endS, pxPerSec } = opts;
  if (!bpm || bpm <= 0 || endS <= startS) return [];

  const beatS = 60 / bpm;
  const barS = beatS * BEATS_PER_BAR;
  const pxPerBeat = beatS * pxPerSec;

  const showBeats = pxPerBeat >= MIN_PX_PER_BEAT_FOR_BEATS;
  const showDiv8 = pxPerBeat >= MIN_PX_PER_BEAT_FOR_DIV8;
  const showDiv16 = pxPerBeat >= MIN_PX_PER_BEAT_FOR_DIV16;

  const ticks: RulerTick[] = [];

  // Compute the first beat-index at or before startS so we can iterate
  // forward without missing the first visible tick. Clamp to 0 so the
  // intro silence (before `beatPhase`, i.e. the part of the recording
  // captured before the music started) stays empty — Bar 1 lands on the
  // first real beat, not on a fictional negative-bar a hop before the
  // performance.
  const firstBeatIdx = Math.max(0, Math.floor((startS - beatPhase) / beatS));
  const lastBeatIdx = Math.ceil((endS - beatPhase) / beatS);

  for (let i = firstBeatIdx; i <= lastBeatIdx; i++) {
    const beatT = beatPhase + i * beatS;
    if (beatT < startS - 1e-9 || beatT > endS + 1e-9) continue;

    const isBarStart = i % BEATS_PER_BAR === 0;
    if (isBarStart) {
      const barNumber = Math.floor(i / BEATS_PER_BAR) + 1;
      ticks.push({ t: beatT, kind: "bar", barNumber });
    } else if (showBeats) {
      ticks.push({ t: beatT, kind: "beat" });
    }

    // 1/8 ticks (= half-beats): one between every consecutive beat pair.
    if (showDiv8) {
      const halfT = beatT + beatS / 2;
      if (halfT >= startS - 1e-9 && halfT <= endS + 1e-9) {
        ticks.push({ t: halfT, kind: "div8" });
      }
    }
    // 1/16 ticks (= quarter-beats): two more per beat.
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
  // Sort ascending in time; subdivisions and beats may have been emitted
  // out of order during the per-beat loop.
  ticks.sort((a, b) => a.t - b.t);
  void barS; // (currently only beat-period drives the layout; barS kept readable)
  return ticks;
}
