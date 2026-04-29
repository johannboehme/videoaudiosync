/**
 * Live-Preview-Overlay für Punch-In-FX.
 *
 * Eine transparente Canvas, absolut positioniert über dem `<video>`-Stack
 * von `MultiCamPreview`. Der Browser GPU-composit beide Layers — das
 * Video bleibt unangetastet (kein Eingriff in den Decode-Pfad), und FX
 * lassen sich frei darüberlegen.
 *
 * Performance-Strategie: RAF läuft *nur* solange ≥ 1 FX an currentTime
 * aktiv ist, ein live Hold läuft, oder das Video gerade abspielt. Im
 * stillen Editor ist die Komponente komplett idle — kein RAF, keine GPU-
 * Last. Bei Kanten-Wechseln (Edit, Hold-Beginn, Play) wird die Schleife
 * neu angeworfen.
 */
import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { detectCapabilities } from "../../local/capabilities";
import { activeFxAt } from "../fx/active";
import { createFxRenderer, type FxRenderer } from "../fx/render";

interface Props {
  /** Optional cap on devicePixelRatio for the overlay surface. Mobile
   *  GPUs profit from staying at 2 even on 3x screens, since the
   *  full-screen FX don't need crisp 1px detail. */
  maxDpr?: number;
}

export function FxOverlay({ maxDpr = 2 }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<FxRenderer | null>(null);
  const rafRef = useRef<number | null>(null);
  /** Bumps every time the store edits something that should trigger a
   *  one-shot redraw even when paused (e.g. user added/dragged a fx). */
  const dirtyTickRef = useRef(0);

  // Mount the renderer once (capability-pick + canvas creation).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const caps = detectCapabilities();
    const renderer = createFxRenderer(canvas, { webgl2: caps.webgl2 });
    rendererRef.current = renderer;
    if (typeof window !== "undefined") {
      // One-line dev hint so the user can see which path is active.
      console.info(`[fx] backend=${renderer.backend}`);
    }
    return () => {
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // Resize-observe the wrapper. The canvas matches the wrapper's CSS
  // bounds; the renderer applies DPR internally.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const apply = () => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const rect = wrapper.getBoundingClientRect();
      const dpr = Math.min(maxDpr, window.devicePixelRatio || 1);
      renderer.resize(rect.width, rect.height, dpr);
      // After resize, the canvas is cleared — bump dirty so the RAF
      // schedules a one-shot redraw with the current fx state.
      dirtyTickRef.current++;
      ensureRunning();
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(wrapper);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [maxDpr]);

  // RAF loop: read store-state directly each tick (no React re-renders).
  useEffect(() => {
    function tick() {
      rafRef.current = null;
      const renderer = rendererRef.current;
      if (!renderer) return;
      const s = useEditorStore.getState();
      const t = s.playback.currentTime;
      const active = activeFxAt(s.fx, t);
      renderer.render(t, active);
      const wantsTick =
        s.playback.isPlaying ||
        active.length > 0 ||
        Object.keys(s.fxHolds).length > 0 ||
        dirtyTickRef.current > 0;
      // Consume one dirty token per tick — guarantees one redraw after
      // edit-while-paused without leaking ticks.
      if (dirtyTickRef.current > 0) dirtyTickRef.current--;
      if (wantsTick) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }

    function ensureRunningInner() {
      if (rafRef.current === null) {
        rafRef.current = requestAnimationFrame(tick);
      }
    }
    ensureRunningInnerRef.current = ensureRunningInner;

    // Subscribe to store changes that should re-arm the loop.
    const unsubPlaying = useEditorStore.subscribe(
      (s) => s.playback.isPlaying,
      (isPlaying) => {
        if (isPlaying) ensureRunningInner();
      },
    );
    const unsubFx = useEditorStore.subscribe(
      (s) => s.fx,
      () => {
        dirtyTickRef.current++;
        ensureRunningInner();
      },
    );
    const unsubHolds = useEditorStore.subscribe(
      (s) => s.fxHolds,
      () => {
        dirtyTickRef.current++;
        ensureRunningInner();
      },
    );
    const unsubSeek = useEditorStore.subscribe(
      (s) => s.playback.seekRequest,
      () => {
        dirtyTickRef.current++;
        ensureRunningInner();
      },
    );

    // Kick off in case state already wants ticking on mount.
    ensureRunningInner();

    return () => {
      unsubPlaying();
      unsubFx();
      unsubHolds();
      unsubSeek();
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, []);

  // Used by the resize-observer effect — needs a stable reference, so we
  // route through a ref that the RAF effect populates.
  const ensureRunningInnerRef = useRef<(() => void) | null>(null);
  function ensureRunning() {
    ensureRunningInnerRef.current?.();
  }

  return (
    <div
      ref={wrapperRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block"
        style={{ background: "transparent" }}
      />
    </div>
  );
}
