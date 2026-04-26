/**
 * Side-effect layer for the live A/V offset preview.
 *
 * The math is in `OffsetScheduler.ts` (pure, unit-tested). This hook wires it
 * to a real `<video>` element and a real `AudioContext`:
 *
 * 1. Decode the studio audio once into an AudioBuffer (mono is enough for
 *    preview — saves RAM on long recordings).
 * 2. The video element plays muted. Time updates are driven by
 *    `requestVideoFrameCallback` for sub-frame accuracy.
 * 3. On each play() and on each loop boundary, schedule a fresh
 *    AudioBufferSourceNode at `videoTime - totalOffsetMs/1000`. Re-scheduling
 *    on the loop boundary is the natural re-sync point — no drift accumulates.
 * 4. AbortController-style cleanup: every running source is stopped before a
 *    new one is scheduled.
 *
 * The hook is small and AudioContext is hard to test in jsdom, so this layer
 * is validated manually with real footage.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  computeAudioStartOffset,
  shouldRescheduleOnTick,
} from "./OffsetScheduler";
import { useEditorStore } from "./store";

type VideoFrameCallback = (now: number, metadata: { mediaTime: number }) => void;

type VideoElementWithRVFC = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: VideoFrameCallback) => number;
  cancelVideoFrameCallback?: (handle: number) => void;
};

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
  const rvfcHandleRef = useRef<number | null>(null);

  const [isReady, setIsReady] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        // decodeAudioData returns the buffer; we keep it as-is (stereo if the
        // source is stereo) — modern browsers handle this without RAM blow-ups
        // for typical 5-minute recordings.
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
      const v = videoRef.current as VideoElementWithRVFC | null;
      if (v && rvfcHandleRef.current !== null && v.cancelVideoFrameCallback) {
        v.cancelVideoFrameCallback(rvfcHandleRef.current);
      }
      ctxRef.current?.close().catch(() => undefined);
      ctxRef.current = null;
    };
    // videoRef is stable (ref objects don't change identity)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Schedule an audio source corresponding to the current video position.
  const scheduleAudio = useCallback(() => {
    const ctx = ctxRef.current;
    const buffer = bufferRef.current;
    const v = videoRef.current;
    if (!ctx || !buffer || !v) return;

    if (sourceRef.current) {
      try {
        sourceRef.current.stop();
      } catch {
        /* already stopped */
      }
      sourceRef.current = null;
    }

    const state = useEditorStore.getState();
    const totalMs = state.totalOffsetMs();
    const start = computeAudioStartOffset({
      videoTime: v.currentTime,
      totalOffsetMs: totalMs,
      audioDuration: buffer.duration,
    });
    if (start === null) return; // out of buffer; play silence

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(ctx.destination);
    // start now (small leadIn for safety against AudioContext currentTime jitter)
    const leadIn = 0.01;
    src.start(ctx.currentTime + leadIn, start);
    sourceRef.current = src;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Public API: triggered from outside via store subscriptions in the
  // VideoCanvas — but to keep the hook self-contained we react to play state
  // here.
  useEffect(() => {
    const v = videoRef.current as VideoElementWithRVFC | null;
    if (!v) return;

    let lastLoop: { start: number; end: number } | null = null;
    let lastTotalMs = useEditorStore.getState().totalOffsetMs();

    const onPlay = () => {
      ctxRef.current?.resume().catch(() => undefined);
      scheduleAudio();
    };
    const onPause = () => {
      if (sourceRef.current) {
        try {
          sourceRef.current.stop();
        } catch {
          /* already stopped */
        }
        sourceRef.current = null;
      }
    };
    const onSeeked = () => {
      if (!v.paused) scheduleAudio();
    };

    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    v.addEventListener("seeked", onSeeked);

    // Frame-accurate tick: keep store.currentTime in sync, and detect loop
    // boundaries / scrubs.
    const tick = (_now: number, metadata: { mediaTime: number }) => {
      const t = metadata.mediaTime;
      const store = useEditorStore.getState();
      // mirror video time into the store
      store.setCurrentTime(t);

      const loop = store.playback.loop;
      const totalMs = store.totalOffsetMs();
      const offsetChanged = totalMs !== lastTotalMs;

      // Loop wrap?
      if (
        loop &&
        shouldRescheduleOnTick({ videoTime: t, loop }) &&
        store.playback.isPlaying
      ) {
        v.currentTime = loop.start;
        // wait for `seeked` to schedule
      } else if (offsetChanged && !v.paused) {
        // Live offset adjustment while playing — reschedule audio at new offset
        scheduleAudio();
      }
      lastLoop = loop;
      lastTotalMs = totalMs;
      void lastLoop;
      // re-arm
      if (v.requestVideoFrameCallback) {
        rvfcHandleRef.current = v.requestVideoFrameCallback(tick);
      }
    };

    if (v.requestVideoFrameCallback) {
      rvfcHandleRef.current = v.requestVideoFrameCallback(tick);
    } else {
      // fallback for browsers without rVFC: 60Hz timer
      const id = window.setInterval(() => {
        const store = useEditorStore.getState();
        store.setCurrentTime(v.currentTime);
        const loop = store.playback.loop;
        if (
          loop &&
          shouldRescheduleOnTick({ videoTime: v.currentTime, loop }) &&
          store.playback.isPlaying
        ) {
          v.currentTime = loop.start;
        }
      }, 16);
      rvfcHandleRef.current = id as unknown as number;
    }

    return () => {
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
      v.removeEventListener("seeked", onSeeked);
      const handle = rvfcHandleRef.current;
      if (handle === null) return;
      if (typeof v.cancelVideoFrameCallback === "function") {
        v.cancelVideoFrameCallback(handle);
      } else {
        clearInterval(handle);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isReady]);

  return { isReady, audioDuration, error };
}
