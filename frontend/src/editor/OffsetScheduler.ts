/**
 * Pure math + side-effect-free helpers for the live A/V offset preview loop.
 *
 * Why this lives behind a pure interface:
 *   AudioContext can't be exercised in jsdom, so the testable "what should
 *   happen" lives here as pure functions. The thin DOM-touching part lives in
 *   useAudioMaster.ts and is validated manually with real footage.
 *
 * Sign convention for `totalOffsetMs`:
 *   POSITIVE  = studio audio should LAG video by this many ms
 *               (= the studio sample heard at video=t was recorded at t-offset)
 *   NEGATIVE  = studio audio should LEAD video
 *
 * This matches the algorithm's existing `sync_offset_ms`.
 */

export interface ComputeOffsetArgs {
  videoTime: number;
  totalOffsetMs: number;
  audioDuration?: number;
}

/**
 * Given the current video time and the desired total offset (algorithm +
 * user override), return the position inside the AudioBuffer to start playing
 * from. Returns null if the requested position falls outside the buffer.
 */
export function computeAudioStartOffset({
  videoTime,
  totalOffsetMs,
  audioDuration,
}: ComputeOffsetArgs): number | null {
  const start = videoTime - totalOffsetMs / 1000;
  if (start < 0) return 0;
  if (audioDuration !== undefined && start >= audioDuration) return null;
  return start;
}

export interface LoopRegion {
  start: number;
  end: number;
}

export interface TrimRegion {
  in: number;
  out: number;
}

/**
 * The user's loop selection must stay inside the trim region — playing audio
 * from a region that won't be in the final render is misleading.
 * Returns null when the loop has no overlap with the trim region.
 */
export function clampLoopRegion(
  loop: LoopRegion,
  trim: TrimRegion,
): LoopRegion | null {
  const start = Math.max(loop.start, trim.in);
  const end = Math.min(loop.end, trim.out);
  if (end <= start) return null;
  return { start, end };
}

/**
 * Should we re-seek + re-schedule the audio source? Triggers on:
 *   - playhead crossed past loop.end → wrap back to start
 *   - playhead jumped before loop.start (user scrubbed) → restart loop
 *
 * `pendingWrapAt` overrides the default trigger: while it's set (non-null)
 * the only condition that matters is `videoTime >= pendingWrapAt`. Used by
 * the OP-1 style loop-shift, where the loop region jumps ahead but the
 * playhead must keep playing in the now-out-of-loop zone until it reaches
 * the *old* loop end.
 */
export function shouldRescheduleOnTick({
  videoTime,
  loop,
  pendingWrapAt,
}: {
  videoTime: number;
  loop: LoopRegion | null;
  pendingWrapAt?: number | null;
}): boolean {
  if (!loop) return false;
  if (pendingWrapAt != null) return videoTime >= pendingWrapAt;
  return videoTime >= loop.end || videoTime < loop.start;
}
