/**
 * Phase-2 unified compositor — replaces the V1 stack of one `<video>`
 * per cam + transparent FX overlay canvas.
 *
 * Layout (back → front):
 *   1. <MasterAudio> outside the OutputFrameBox — invisible, drives the
 *      master clock. Same as V1.
 *   2. Hidden `<video>` pool (display:none) — owned by `PreviewRuntime`
 *      via `VideoElementPool`. Each cam's <video> stays mounted so its
 *      decoder stays warm.
 *   3. <OutputFrameBox> wrapper that letterbox/pillarboxes a single
 *      `<canvas>` to the resolved output AR.
 *   4. <TestPattern> shown when no cam has material at currentTime
 *      (CSS DOM overlay — keeps parity-risk vs the V1 SMPTE bars zero,
 *      and the backend stays out of the test-pattern business).
 *
 * Behind feature flag `?compositor=v2` (or `localStorage.vasCompositor=v2`).
 * V1 (`MultiCamPreview`) remains the default until the parity checklist
 * passes and we've dogfooded for a release.
 */
import { useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import { detectCapabilities } from "../../local/capabilities";
import { MasterAudio } from "./MasterAudio";
import { TestPattern } from "./TestPattern";
import { OutputFrameBox } from "./OutputFrameBox";
import { PreviewRuntime, type ClipUrlMap } from "../render/preview-runtime";
import { COMPOSITOR_INITIAL_SCALE } from "../render/feature-flag";

interface Props {
  cams: ClipUrlMap;
  audioUrl: string;
}

export function Compositor({ cams, audioUrl }: Props) {
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const activeCamId = useEditorStore((s) => s.activeCamId(currentTime));
  const showTestPattern = activeCamId === null;

  return (
    <div className="relative w-full h-full bg-sunken overflow-hidden">
      <MasterAudio audioUrl={audioUrl} />

      {showTestPattern && (
        <div className="absolute inset-0">
          <TestPattern />
        </div>
      )}

      <OutputFrameBox>
        <CompositorCanvas cams={cams} />
      </OutputFrameBox>
    </div>
  );
}

/** The canvas + runtime mount. Lives inside OutputFrameBox so its CSS
 *  size already equals the letterbox/pillarbox-fitted output box. */
function CompositorCanvas({ cams }: { cams: ClipUrlMap }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const poolHostRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<PreviewRuntime | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const poolHost = poolHostRef.current;
    if (!canvas || !poolHost) return;

    const rect = canvas.getBoundingClientRect();
    const cssW = Math.max(1, Math.round(rect.width));
    const cssH = Math.max(1, Math.round(rect.height));
    const dpr = window.devicePixelRatio || 1;

    const runtime = new PreviewRuntime({
      canvas,
      cams,
      capabilities: detectCapabilities(),
      cssW,
      cssH,
      dpr,
      initialScale: COMPOSITOR_INITIAL_SCALE,
    });
    // Expose the runtime so devs can tweak `setScale(0.75)` from the
    // console without a reload. Read-only by external code — owned by
    // this component and disposed on unmount.
    (window as unknown as { __vasCompositor?: PreviewRuntime }).__vasCompositor = runtime;

    let cancelled = false;
    void runtime
      .init()
      .then(() => {
        if (cancelled) {
          runtime.dispose();
          return;
        }
        runtime.attachVideoPool(poolHost);
        runtime.start();
        runtimeRef.current = runtime;
      })
      .catch((err) => {
        console.error("[compositor] init failed:", err);
        setError(String(err));
      });

    return () => {
      cancelled = true;
      runtimeRef.current = null;
      runtime.dispose();
      const w = window as unknown as { __vasCompositor?: PreviewRuntime };
      if (w.__vasCompositor === runtime) delete w.__vasCompositor;
    };
    // We deliberately do NOT depend on `cams` here — the runtime
    // reconciles its pool on every tick via `setCams(...)`, so adding
    // / removing a cam doesn't tear down the backend / decoder pool.
    // Initial cams are captured in the constructor; subsequent changes
    // flow through the descriptor builder + pool reconciliation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the canvas's container size and forward to the runtime.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, Math.round(rect.width));
      const cssH = Math.max(1, Math.round(rect.height));
      runtimeRef.current?.resize(cssW, cssH, window.devicePixelRatio || 1);
    });
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // Page Visibility — pause the RAF when the tab is hidden so we don't
  // burn cycles in a background tab.
  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "hidden") {
        runtimeRef.current?.stop();
      } else {
        runtimeRef.current?.start();
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  return (
    <>
      {/* Off-screen `<video>` pool. display:none on each element keeps
          the layout free of these and gives the decoder a stable home. */}
      <div ref={poolHostRef} aria-hidden style={{ display: "none" }} />
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full"
        style={{ background: "#1A1816" }}
      />
      {error && (
        <div
          role="alert"
          className="absolute inset-0 flex items-center justify-center text-[#ff8080] text-xs"
        >
          Compositor failed: {error}
        </div>
      )}
    </>
  );
}
