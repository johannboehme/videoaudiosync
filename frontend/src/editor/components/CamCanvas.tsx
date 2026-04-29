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
import { clipRangeS, type VideoClip } from "../types";
import { camSourceTimeS } from "../../local/timing/cam-time";

interface Props {
  videoUrl: string;
  /** When false, the element is rendered with `display:none` so it
   *  doesn't paint over the active cam. Hidden cams stay mounted so the
   *  browser keeps decoding their material — toggling display is far
   *  cheaper than unmount/remount and avoids a black flash on cut. */
  visible: boolean;
  clip: VideoClip;
}

export function CamCanvas({ videoUrl, visible, clip }: Props) {
  const ref = useRef<HTMLVideoElement>(null);
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
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

  // store.currentTime is master-time (anchored to the master audio).
  // sourceT = where this cam's <video> should be playing internally.
  // Same `camSourceTimeS` helper the render pipeline uses, so what the
  // user sees here is what gets baked.
  const masterT = currentTime;
  const range = clipRangeS(clip);
  const sourceT = camSourceTimeS(masterT, {
    masterStartS: range.startS,
    driftRatio: clip.driftRatio,
  });
  const hasMaterial = sourceT >= 0 && sourceT < clip.sourceDurationS;

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    if (!hasMaterial) {
      if (!v.paused) v.pause();
      return;
    }
    // Drift correction: snap to target if we're off by more than 100 ms.
    // Browsers handle ~50 ms of drift gracefully; > 100 ms is audible /
    // visible enough to warrant a hard seek.
    if (Math.abs(v.currentTime - sourceT) > 0.1) {
      try {
        v.currentTime = Math.max(0, Math.min(clip.sourceDurationS, sourceT));
      } catch {
        /* element not ready yet — next tick */
      }
    }
    if (isPlaying && v.paused) {
      v.play().catch(() => undefined);
    } else if (!isPlaying && !v.paused) {
      v.pause();
    }
  }, [hasMaterial, isPlaying, sourceT, clip.sourceDurationS]);

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
        display: visible ? "block" : "none",
        objectFit: "contain",
        background: "#1A1816",
      }}
    />
  );
}
