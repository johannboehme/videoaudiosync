/**
 * Passive cam slave. Each cam in the preview is a `CamCanvas` that:
 *   - reports its post-rotation natural dims into the store (feeds the
 *     output-frame bounding-box resolver),
 *   - reads `playback.currentTime` (master-time) from the store and seeks
 *     its own <video> to the corresponding source-time via `camSourceTimeS`,
 *   - plays when master is inside the cam's material range AND the store
 *     says we're playing, pauses otherwise.
 *
 * Importantly: no cam touches the master clock. The clock lives in the
 * `<MasterAudio>` element and is mirrored by `useAudioMaster` into the
 * store. Removing one cam — even cam-1 — does not stop the timeline.
 */
import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { clipRangeS, normaliseRotation, type VideoClip } from "../types";
import { camSourceTimeS } from "../../local/timing/cam-time";

interface Props {
  videoUrl: string;
  /** When false, the element is hidden via `visibility: hidden` (not
   *  `display: none`). Both keep the cam mounted so the decoder stays hot,
   *  but `visibility` ALSO preserves the GPU compositor layer and the
   *  rasterised first-frame buffer. With `display: none` the browser
   *  destroys the layer; switching back forces a fresh layer allocation
   *  and a frame upload, which manifests as a "first switch is slowest"
   *  visible jank. `visibility` is a one-property flip the compositor
   *  handles in microseconds. */
  visible: boolean;
  clip: VideoClip;
}

export function CamCanvas({ videoUrl, visible, clip }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const warmedRef = useRef(false);
  const setClipDisplayDims = useEditorStore((s) => s.setClipDisplayDims);

  // Report post-rotation natural dims so the output-frame resolver can
  // bound-box across all cams. Browsers populate videoWidth/Height with
  // the rotation matrix already applied.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const report = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setClipDisplayDims(clip.id, v.videoWidth, v.videoHeight);
      }
    };
    v.addEventListener("loadedmetadata", report);
    v.addEventListener("resize", report);
    report();
    return () => {
      v.removeEventListener("loadedmetadata", report);
      v.removeEventListener("resize", report);
    };
  }, [clip.id, setClipDisplayDims, videoUrl]);

  // Decoder warmup. Once the element has its first frame ready
  // (HAVE_CURRENT_DATA), do a one-shot play()→pause(). This pushes a
  // decoded frame into the GPU layer so the very first cam-switch the
  // user makes already has a real picture to present, and the H.264 /
  // AV1 / VP9 decoder has spun up on the worker thread that owns this
  // element. Without it, the decoder's first-decode latency lands on
  // the moment the user presses 1-9, not on app load. Muted videos are
  // allowed to autoplay so this works without any user gesture.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (warmedRef.current) return;
    const warm = () => {
      if (warmedRef.current) return;
      if (v.readyState < 2 /* HAVE_CURRENT_DATA */) return;
      warmedRef.current = true;
      const p = v.play();
      const stop = () => {
        if (!v.paused) v.pause();
      };
      if (p && typeof p.then === "function") {
        p.then(stop).catch(() => undefined);
      } else {
        stop();
      }
    };
    if (v.readyState >= 2) {
      warm();
    } else {
      v.addEventListener("loadeddata", warm, { once: true });
    }
    return () => {
      v.removeEventListener("loadeddata", warm);
    };
  }, [videoUrl]);

  // Sync the cam's <video> element to master-time.
  //
  // Why this is one mount-effect and NOT a useEffect with `currentTime`
  // in the deps array: `playback.currentTime` updates ~60 Hz during
  // playback (×2 in StrictMode dev), and a deps-driven effect tears
  // down + rebinds at that rate per cam. With multiple cams that's
  // hundreds of effect re-bindings per second of pure React overhead,
  // even when the body short-circuits.
  //
  // Instead we subscribe directly to the store with a narrow selector;
  // the callback runs synchronously inside `set()`, but the body is
  // tiny (one float compare) and there's zero React reconciliation.
  // Same mathematical behaviour, far cheaper steady state.
  //
  // Anchor (NOT visible-startS) is what feeds camSourceTimeS — trim is
  // a true cut, the cam plays from source-time `trimInS` at the visible
  // left edge, not from source frame 0.
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const range = clipRangeS(clip);
    const driftRatio = clip.driftRatio;
    const sourceDurS = clip.sourceDurationS;

    function sync(masterT: number, isPlaying: boolean): void {
      if (!v) return;
      const sourceT = camSourceTimeS(masterT, {
        masterStartS: range.anchorS,
        driftRatio,
      });
      const inRange = sourceT >= 0 && sourceT < sourceDurS;
      if (!inRange) {
        if (!v.paused) v.pause();
        return;
      }
      // Drift correction: hard seek when more than 100 ms off. Browsers
      // handle ~50 ms gracefully; > 100 ms is visible / audible.
      if (Math.abs(v.currentTime - sourceT) > 0.1) {
        try {
          v.currentTime = Math.max(0, Math.min(sourceDurS, sourceT));
        } catch {
          /* element not ready yet — next tick */
        }
      }
      if (isPlaying && v.paused) {
        v.play().catch(() => undefined);
      } else if (!isPlaying && !v.paused) {
        v.pause();
      }
    }

    // Initial sync from current state.
    {
      const s = useEditorStore.getState();
      sync(s.playback.currentTime, s.playback.isPlaying);
    }

    // React to currentTime changes only. isPlaying changes are rarer
    // and observed via a separate selector so we don't fire on every
    // currentTime tick AND every isPlaying tick.
    const unsubTime = useEditorStore.subscribe(
      (s) => s.playback.currentTime,
      (t) => {
        sync(t, useEditorStore.getState().playback.isPlaying);
      },
    );
    const unsubPlay = useEditorStore.subscribe(
      (s) => s.playback.isPlaying,
      (isPlaying) => {
        sync(useEditorStore.getState().playback.currentTime, isPlaying);
      },
    );
    return () => {
      unsubTime();
      unsubPlay();
    };
  }, [clip]);

  // CSS transform mirrors what the compositor applies during export:
  // rotate first, then flip — so a horizontal mirror stays horizontal
  // from the user's point of view regardless of rotation.
  const rot = normaliseRotation(clip.rotation);
  const sx = clip.flipX ? -1 : 1;
  const sy = clip.flipY ? -1 : 1;
  const transform =
    rot === 0 && sx === 1 && sy === 1
      ? undefined
      : `rotate(${rot}deg) scale(${sx}, ${sy})`;
  return (
    <video
      ref={ref}
      src={videoUrl}
      muted
      playsInline
      crossOrigin="anonymous"
      preload="auto"
      className="absolute inset-0 w-full h-full"
      style={{
        // visibility (not display) — see Props.visible doc-comment for
        // why. willChange: transform asks the browser to keep this on a
        // dedicated GPU layer so the visibility flip is a one-bit
        // compositor toggle, not a layer rebuild.
        visibility: visible ? "visible" : "hidden",
        objectFit: "contain",
        background: "#1A1816",
        transform,
        transformOrigin: "center center",
        willChange: "transform",
      }}
    />
  );
}
