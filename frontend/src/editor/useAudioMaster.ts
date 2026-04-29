/**
 * Master-clock hook — `<audio>` element drives the editor.
 *
 * Architecture (post audio-master-clock-rewrite):
 *   The master timeline has exactly one source-of-truth: the studio
 *   audio. The hook owns no DOM itself; the caller mounts an `<audio>`
 *   element with a ref and passes that ref + the URL in. From there:
 *
 *     - `audioElement.currentTime` IS master-time. While playing, a RAF
 *       tick mirrors it into `playback.currentTime`.
 *     - `audioElement.duration` (from `loadedmetadata`) is the master
 *       timeline length.
 *     - Store -> audio: setPlaying / seek translate into
 *       audio.play / pause / currentTime writes.
 *
 *   Cams are passive. CamCanvas reads `playback.currentTime` from the
 *   store, computes its own source-time via `camSourceTimeS`, and seeks
 *   its own <video> to match. There is no master cam; cam-1 is just
 *   "the first cam" with no special clock semantics.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useEditorStore } from "./store";
import { shouldRescheduleOnTick } from "./OffsetScheduler";

export interface AudioMasterHandle {
  isReady: boolean;
  audioDuration: number | null;
  error: string | null;
}

export function useAudioMaster(
  audioRef: React.RefObject<HTMLAudioElement | null>,
  audioUrl: string | null,
): AudioMasterHandle {
  const [isReady, setIsReady] = useState(false);
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const seekRequest = useEditorStore((s) => s.playback.seekRequest);

  const rafRef = useRef<number | null>(null);
  /** Pending seek that arrived before the audio reported metadata.
   *  Replayed once `loadedmetadata` fires. Without this the app's first
   *  programmatic seek (e.g. trim-restore on editor open) would silently
   *  miss the audio element. */
  const pendingSeekRef = useRef<number | null>(null);

  // Reset readiness whenever the URL changes (a fresh element will report
  // its own loadedmetadata).
  useEffect(() => {
    setIsReady(false);
    setAudioDuration(null);
    setError(null);
  }, [audioUrl]);

  // loadedmetadata: master duration becomes available, replay any
  // pending seek, transition to ready.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    function onLoaded() {
      const a = audioRef.current;
      if (!a) return;
      setAudioDuration(Number.isFinite(a.duration) ? a.duration : null);
      setIsReady(true);
      const pending = pendingSeekRef.current;
      if (pending !== null) {
        try {
          a.currentTime = clampSeek(pending, a.duration);
        } catch {
          /* element not ready */
        }
        pendingSeekRef.current = null;
      }
    }
    function onError() {
      setError(audio?.error?.message ?? "audio error");
    }
    audio.addEventListener("loadedmetadata", onLoaded);
    audio.addEventListener("error", onError);
    if (audio.readyState >= 1) onLoaded();
    return () => {
      audio.removeEventListener("loadedmetadata", onLoaded);
      audio.removeEventListener("error", onError);
    };
  }, [audioRef, audioUrl]);

  // Apply seek requests. Queue them when the audio isn't ready yet so
  // the editor can issue trim-restore / nav-jump seeks during boot.
  useEffect(() => {
    if (seekRequest === null) return;
    const audio = audioRef.current;
    const clear = useEditorStore.getState().clearSeekRequest;
    if (!audio || !isReady) {
      pendingSeekRef.current = seekRequest;
      clear();
      return;
    }
    try {
      audio.currentTime = clampSeek(seekRequest, audio.duration);
    } catch {
      /* element not ready — keep pending */
      pendingSeekRef.current = seekRequest;
    }
    clear();
  }, [seekRequest, isReady, audioRef]);

  /** Stop the per-frame loop. Idempotent. */
  const stopRaf = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }, []);

  // Play / pause + RAF mirror loop. The single effect handles transitioning
  // into playback, pausing on transition out, and per-frame currentTime
  // mirroring.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!isPlaying || !isReady) {
      stopRaf();
      // Defensive pause — the audio element may still be playing if the
      // store's setPlaying(false) is the only signal we got.
      if (!audio.paused) {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
      }
      return;
    }

    // Kick the audio off. play() may reject if the user hasn't gestured
    // yet (autoplay policy); the editor's transport bar fires this in a
    // click handler so we typically have a gesture context.
    audio.play().catch((err) => {
      // Surface the failure but don't break the loop — the user can
      // retry by hitting space again.
      setError(err instanceof Error ? err.message : "audio.play() failed");
    });

    function tick() {
      const a = audioRef.current;
      if (!a) {
        rafRef.current = null;
        return;
      }
      const store = useEditorStore.getState();
      if (!store.playback.isPlaying) {
        rafRef.current = null;
        return;
      }
      const dur = store.jobMeta?.duration ?? Infinity;
      let t = a.currentTime;

      // Auto-pause at master-timeline end. This is the single termination
      // gate — the audio element fires `ended` too, but RAF is more
      // responsive (fires before the audio element does in some browsers).
      if (t >= dur) {
        store.setCurrentTime(dur);
        store.setPlaying(false);
        rafRef.current = null;
        return;
      }
      store.setCurrentTime(t);

      // Loop-region wrap. The store mutates currentTime via seek(); the
      // seek effect above turns that into an audio.currentTime write.
      const loop = store.playback.loop;
      if (loop && shouldRescheduleOnTick({ videoTime: t, loop })) {
        store.seek(loop.start);
      }

      rafRef.current = requestAnimationFrame(tick);
    }

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      stopRaf();
      if (audio && !audio.paused) {
        try {
          audio.pause();
        } catch {
          /* ignore */
        }
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, isReady]);

  return { isReady, audioDuration, error };
}

function clampSeek(t: number, duration: number): number {
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, t);
  return Math.max(0, Math.min(duration, t));
}
