/**
 * Side-effect layer for the live A/V offset preview.
 *
 * Architecture (master-time anchored):
 *   - The *master clock* is derived from the AudioContext's currentTime,
 *     not from any video element. This is what lets the playhead sit at
 *     master t=0 even when cam-1 starts at master t=8 — the clock keeps
 *     advancing through the "no-cam-1" pre-roll, and cam-1 simply doesn't
 *     play until master reaches its range.
 *   - cam-1's <video> follows: while playing, its currentTime is set to
 *     `masterT - cam1.startS` (clamped to the video's own duration), and
 *     it's only allowed to play() when master is inside cam-1's range.
 *   - Master audio is scheduled once per play() / seek-during-play /
 *     candidate-switch. The buffer offset is `max(0, masterT)` and the
 *     audio start is delayed by `max(0, -masterT)` so a play at negative
 *     master-time correctly waits before starting the buffer at position 0.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeAudioStartOffset,
  shouldRescheduleOnTick,
} from "./OffsetScheduler";
import { useEditorStore } from "./store";
import { clipRangeS } from "./types";

void computeAudioStartOffset; // kept exported via tests; not used here directly

/** Read cam-1's master-timeline startS from the store. */
function cam1StartS(state = useEditorStore.getState()): number {
  const cam1 = state.clips[0];
  return cam1 ? clipRangeS(cam1).startS : 0;
}

export interface OffsetSchedulerHandle {
  isReady: boolean;
  audioDuration: number | null;
  error: string | null;
}

export function useOffsetScheduler(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  studioAudioUrl: string | null,
): OffsetSchedulerHandle {
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  /** When the master clock was last (re)seeded — both via ctx.currentTime
   *  (canonical) and via performance.now() (fallback when ctx isn't
   *  available). The masterT at that seed point is recorded so the RAF
   *  loop can derive masterT at any subsequent moment. */
  const clockSeedRef = useRef<{
    ctxTime: number | null;
    perfNow: number;
    masterT: number;
  } | null>(null);
  const rafRef = useRef<number | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const seekRequest = useEditorStore((s) => s.playback.seekRequest);

  // Decode the studio audio once.
  useEffect(() => {
    if (!studioAudioUrl) return;
    let cancelled = false;
    setIsReady(false);
    setError(null);

    async function decode(url: string) {
      try {
        const Ctor =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext?: typeof AudioContext })
            .webkitAudioContext;
        if (!Ctor) throw new Error("Web Audio API unavailable");
        const ctx = new Ctor({ sampleRate: 48000 });
        ctxRef.current = ctx;
        const resp = await fetch(url, { credentials: "same-origin" });
        if (!resp.ok) throw new Error(`Audio fetch ${resp.status}`);
        const ab = await resp.arrayBuffer();
        if (cancelled) return;
        const buffer: AudioBuffer = await ctx.decodeAudioData(ab);
        if (cancelled) return;
        bufferRef.current = buffer;
        setAudioDuration(buffer.duration);
        setIsReady(true);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      }
    }
    decode(studioAudioUrl);
    return () => {
      cancelled = true;
    };
  }, [studioAudioUrl]);

  // Tear down on unmount.
  useEffect(() => {
    return () => {
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          /* already stopped */
        }
        sourceRef.current = null;
      }
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    };
  }, []);

  /** Stop any running audio source. Idempotent. */
  const stopAudio = useCallback(() => {
    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
    }
  }, []);

  /** Schedule master audio to play starting at the current store
   *  masterT, *and* re-seed the master clock so the RAF loop derives
   *  masterT from the audio context's currentTime. Negative masterT is
   *  allowed: audio is delayed so the buffer's t=0 plays exactly when
   *  the master clock reaches t=0. */
  const scheduleAudio = useCallback(() => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;

    stopAudio();

    const state = useEditorStore.getState();
    const masterT = state.playback.currentTime;

    // Seed the master clock at "now" — masterT will advance by
    // (ctx.currentTime - seed.ctxTime) seconds from here.
    const leadIn = 0.01;
    const seedCtxTime = ctx.currentTime + leadIn;
    clockSeedRef.current = {
      ctxTime: seedCtxTime,
      perfNow: performance.now() + leadIn * 1000,
      masterT,
    };

    // Audio plays only the part of the buffer that overlaps the master
    // timeline from t=0 to t=duration. If masterT < 0, delay the audio
    // start by abs(masterT). If masterT >= duration, don't schedule
    // anything (the master clock will keep advancing in silence until
    // we hit the duration and auto-pause).
    const bufferStart = Math.max(0, masterT);
    if (bufferStart >= buffer.duration) return;

    const audioStartCtxTime = seedCtxTime + Math.max(0, -masterT);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    src.start(audioStartCtxTime, bufferStart);
    sourceRef.current = src;
  }, [stopAudio]);

  // Play / pause / RAF master-clock loop. The single useEffect handles
  // (a) scheduling audio when we transition into playback, (b) tearing
  // it down on pause, and (c) the per-frame loop that drives master-time
  // forward and tells cam-1's <video> what to do.
  useEffect(() => {
    if (!isPlaying || !isReady) {
      stopAudio();
      clockSeedRef.current = null;
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
      return;
    }

    ctxRef.current?.resume().catch(() => undefined);
    scheduleAudio();
    let lastSeenStartS = cam1StartS();

    function tick() {
      const ctx = ctxRef.current;
      const v = videoRef.current;
      const store = useEditorStore.getState();
      if (!store.playback.isPlaying) {
        rafRef.current = null;
        return;
      }
      const startS = cam1StartS(store);
      const dur = store.jobMeta?.duration ?? Infinity;
      const seed = clockSeedRef.current;

      // Derive masterT. AudioContext.currentTime is monotonic and high
      // resolution; use it whenever we have a seed. Wall-clock fallback
      // covers the (rare) case where ctx isn't available.
      let masterT = store.playback.currentTime;
      if (seed) {
        if (ctx && seed.ctxTime !== null) {
          masterT = seed.masterT + (ctx.currentTime - seed.ctxTime);
        } else {
          masterT = seed.masterT + (performance.now() - seed.perfNow) / 1000;
        }
      }

      // Auto-pause at the end of the master timeline.
      if (masterT >= dur) {
        store.setCurrentTime(dur);
        store.setPlaying(false);
        rafRef.current = null;
        return;
      }
      store.setCurrentTime(masterT);

      // Loop wrap (loop region is in master-time).
      const loop = store.playback.loop;
      if (loop && shouldRescheduleOnTick({ videoTime: masterT, loop })) {
        store.seek(loop.start);
        // The seekRequest watcher below reschedules audio.
      }

      // cam-1.startS changed mid-play (drag re-sync, MATCH switch).
      // Re-anchor audio so the master clock remains accurate.
      if (startS !== lastSeenStartS) {
        scheduleAudio();
        lastSeenStartS = startS;
      }

      // Drive cam-1's <video>. It plays only while masterT is inside
      // cam-1's range; outside that window it's paused so it doesn't
      // burn the wrong frame onto the preview surface.
      if (v) {
        const camDur = v.duration || 0;
        const inRange = masterT >= startS && masterT < startS + camDur;
        if (inRange) {
          const targetT = masterT - startS;
          if (Math.abs(v.currentTime - targetT) > 0.15) {
            try {
              v.currentTime = Math.max(0, targetT);
            } catch {
              /* element not ready */
            }
          }
          if (v.paused) v.play().catch(() => undefined);
        } else if (!v.paused) {
          v.pause();
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);

    return () => {
      stopAudio();
      clockSeedRef.current = null;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      const v = videoRef.current;
      if (v && !v.paused) v.pause();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isReady]);

  // Reschedule audio whenever the store fires a seek during playback.
  // Without this the master clock would keep advancing from the old
  // seed and skip-to-start / skip-to-end during play would drift back.
  useEffect(() => {
    if (seekRequest === null) return;
    if (!useEditorStore.getState().playback.isPlaying) return;
    if (!isReady) return;
    scheduleAudio();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekRequest, isReady]);

  return { isReady, audioDuration, error };
}
