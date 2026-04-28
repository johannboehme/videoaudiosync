/**
 * Multi-cam preview surface.
 *
 * Composes the existing single-cam VideoCanvas (which always drives the
 * audio scheduler from cam-1) with N-1 SatelliteCam siblings (other cams,
 * mounted hidden, kept in sync via the store's currentTime). Visibility is
 * driven by the store's `activeCamId` selector — so the user sees the cam
 * that PROGRAM dictates, while audio + master clock stay anchored to cam-1.
 *
 * V1 limitation: cam-1 is the master clock. If cam-1 ends before the
 * master timeline does, playback effectively freezes there. Long-term we
 * want the master AUDIO to drive the clock; that's a deeper rewrite.
 */
import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { clipRangeS, isVideoClip, type VideoClip } from "../types";
import { camSourceTimeS } from "../../local/timing/cam-time";
import { TestPattern } from "./TestPattern";
import { VideoCanvas } from "./VideoCanvas";

interface CamUrlMap {
  [camId: string]: { videoUrl: string };
}

interface Props {
  cams: CamUrlMap;
  audioUrl: string;
}

export function MultiCamPreview({ cams, audioUrl }: Props) {
  const clips = useEditorStore((s) => s.clips);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const activeCamId = useEditorStore((s) => s.activeCamId(currentTime));

  // Cam-1 still drives the playback loop, but the store's currentTime
  // is now master-time directly (computed by useOffsetScheduler from
  // cam-1.video.currentTime + cam1.startS). SatelliteCams therefore
  // can read masterT straight from the store.
  const cam1 = clips[0];
  const cam1Url = cam1 ? cams[cam1.id]?.videoUrl : null;

  if (!cam1 || !cam1Url) {
    return (
      <div className="relative w-full h-full">
        <TestPattern />
      </div>
    );
  }

  const showTestPattern = activeCamId === null;

  // Layer order (back → front):
  //   1. cam-1 (always mounted + always rendering frames; drives audio + clock).
  //   2. each satellite cam, only rendered visibly when it is the active cam.
  //   3. test pattern overlay when no cam has material.
  // We never put `visibility: hidden` on cam-1 — some browsers stop
  // presenting frames on hidden video elements which froze cam-1 the moment
  // the user took another cam ON AIR.
  return (
    <div className="relative w-full h-full bg-sunken overflow-hidden">
      <div className="absolute inset-0">
        <VideoCanvas videoUrl={cam1Url} audioUrl={audioUrl} />
      </div>

      {clips.slice(1).map((clip) => {
        const url = cams[clip.id]?.videoUrl;
        if (!url) return null;
        if (isVideoClip(clip)) {
          return (
            <SatelliteCam
              key={clip.id}
              videoUrl={url}
              visible={activeCamId === clip.id}
              clip={clip}
            />
          );
        }
        // Image clip: render an <img> overlay, only visible when this is the
        // active programme source.
        return (
          <ImageOverlay
            key={clip.id}
            imageUrl={url}
            visible={activeCamId === clip.id}
            filename={clip.filename}
          />
        );
      })}

      {showTestPattern && (
        <div className="absolute inset-0">
          <TestPattern />
        </div>
      )}
    </div>
  );
}

interface SatelliteCamProps {
  videoUrl: string;
  visible: boolean;
  clip: VideoClip;
}

/**
 * A non-master cam <video>. Tracks the store's currentTime (which is cam-1's
 * media-time) and computes its own sourceTime = masterT - clip.startS.
 *
 * Drift correction: if the actual currentTime drifts more than 100 ms from
 * the target, snap it back. Browsers handle ~50 ms drift gracefully on
 * <video.currentTime = …> seeks of preloaded sources.
 */
function SatelliteCam({ videoUrl, visible, clip }: SatelliteCamProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const currentTime = useEditorStore((s) => s.playback.currentTime);

  // store.currentTime is master-time (master-audio reference frame).
  // sourceT = where this satellite cam should be playing internally.
  // The shared `camSourceTimeS` helper applies the per-cam driftRatio so
  // a cam recorded with a slightly different clock than the master audio
  // doesn't drift away over time — same formula the render pipeline uses.
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

interface ImageOverlayProps {
  imageUrl: string;
  visible: boolean;
  filename: string;
}

/** Static image clip — shown as the programme source while it's the active
 *  cam. Object-contained so portrait/landscape images don't get squished. */
function ImageOverlay({ imageUrl, visible, filename }: ImageOverlayProps) {
  return (
    <img
      src={imageUrl}
      alt={filename}
      className="absolute inset-0 w-full h-full"
      style={{
        display: visible ? "block" : "none",
        objectFit: "contain",
        background: "#1A1816",
      }}
    />
  );
}
