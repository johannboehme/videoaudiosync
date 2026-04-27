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
import { clipRangeS, type VideoClip } from "../types";
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

  // Cam-1 is the master — its <video> drives the OffsetScheduler.
  const cam1 = clips[0];
  const cam1Url = cam1 ? cams[cam1.id]?.videoUrl : null;
  const cam1RangeStartS = cam1 ? clipRangeS(cam1).startS : 0;

  if (!cam1 || !cam1Url) {
    return (
      <div className="relative w-full h-full">
        <TestPattern />
      </div>
    );
  }

  const showCam1 = activeCamId === cam1.id;
  const showTestPattern = activeCamId === null;

  return (
    <div className="relative w-full h-full bg-sunken overflow-hidden">
      {/* Master cam (cam-1) — always mounted, hidden when another cam is active */}
      <div className={`absolute inset-0 ${showCam1 ? "" : "invisible"}`}>
        <VideoCanvas videoUrl={cam1Url} audioUrl={audioUrl} />
      </div>

      {/* Satellite cams — one per cam-2..N */}
      {clips.slice(1).map((clip) => {
        const url = cams[clip.id]?.videoUrl;
        if (!url) return null;
        return (
          <SatelliteCam
            key={clip.id}
            videoUrl={url}
            visible={activeCamId === clip.id}
            clip={clip}
            cam1RangeStartS={cam1RangeStartS}
          />
        );
      })}

      {/* No cam at this position → test pattern */}
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
  cam1RangeStartS: number;
}

/**
 * A non-master cam <video>. Tracks the store's currentTime (which is cam-1's
 * media-time) and computes its own sourceTime = masterT - clip.startS.
 *
 * Drift correction: if the actual currentTime drifts more than 100 ms from
 * the target, snap it back. Browsers handle ~50 ms drift gracefully on
 * <video.currentTime = …> seeks of preloaded sources.
 */
function SatelliteCam({ videoUrl, visible, clip, cam1RangeStartS }: SatelliteCamProps) {
  const ref = useRef<HTMLVideoElement>(null);
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const currentTime = useEditorStore((s) => s.playback.currentTime);

  // currentTime is cam-1's media-time → masterT = currentTime + cam-1's startS.
  const masterT = currentTime + cam1RangeStartS;
  const range = clipRangeS(clip);
  const sourceT = masterT - range.startS;
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
