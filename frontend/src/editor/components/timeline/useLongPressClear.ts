/**
 * useLongPressClear — RAF-driven long-press timer for "press-and-hold
 * to clear the strip" gestures.
 *
 * Returns a `progress` value (0..1, or null when idle) plus pointer
 * lifecycle handlers. Call the handlers from a `<div>` that wraps the
 * strip; the parent paints a red fill whose width tracks `progress`
 * and gets cleared on completion or release.
 *
 * Esc cancels too — wired up via a window keydown listener.
 */
import { useCallback, useEffect, useRef, useState } from "react";

export interface UseLongPressClearOpts {
  /** Total hold duration in ms before `onComplete` fires. */
  durationMs: number;
  /** Fired exactly once after `durationMs` of uninterrupted holding. */
  onComplete: () => void;
  /** Disable the gesture entirely (e.g. when strip mode hides this lane). */
  disabled?: boolean;
}

export interface UseLongPressClearResult {
  /** 0..1 progress while a hold is in flight; null when idle. */
  progress: number | null;
  /** Wire to the strip's onPointerDown. */
  start(e: React.PointerEvent<HTMLElement>): void;
  /** Wire to onPointerUp / onPointerCancel / onPointerLeave. */
  cancel(): void;
}

export function useLongPressClear({
  durationMs,
  onComplete,
  disabled = false,
}: UseLongPressClearOpts): UseLongPressClearResult {
  const [progress, setProgress] = useState<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  // Capture the pointer + the element so we can reliably release on
  // pointerup even if the user drags outside the strip.
  const pointerIdRef = useRef<number | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  // Latest onComplete in a ref so the RAF closure picks up fresh
  // callbacks without resetting the timer when the parent re-renders.
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const cancel = useCallback(() => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (pointerIdRef.current != null && targetRef.current) {
      try {
        targetRef.current.releasePointerCapture(pointerIdRef.current);
      } catch {
        /* already released */
      }
    }
    pointerIdRef.current = null;
    targetRef.current = null;
    setProgress(null);
  }, []);

  const start = useCallback(
    (e: React.PointerEvent<HTMLElement>) => {
      if (disabled) return;
      // Only main button starts a long-press. Right-clicks open context
      // menus elsewhere; middle-click is reserved for future use.
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
        pointerIdRef.current = e.pointerId;
        targetRef.current = e.currentTarget;
      } catch {
        /* ignore */
      }
      startTimeRef.current = performance.now();
      setProgress(0);
      const tick = () => {
        const elapsed = performance.now() - startTimeRef.current;
        const t = elapsed / durationMs;
        if (t >= 1) {
          rafRef.current = null;
          if (pointerIdRef.current != null && targetRef.current) {
            try {
              targetRef.current.releasePointerCapture(pointerIdRef.current);
            } catch {
              /* ignore */
            }
          }
          pointerIdRef.current = null;
          targetRef.current = null;
          setProgress(null);
          onCompleteRef.current();
          return;
        }
        setProgress(t);
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    },
    [durationMs, disabled],
  );

  // Esc cancels — convenient and matches Quantize/HoldGesture conventions.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && rafRef.current != null) {
        cancel();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cancel]);

  // Always tear down on unmount.
  useEffect(() => () => cancel(), [cancel]);

  return { progress, start, cancel };
}
