// Muted <video> + Web Audio scheduler. The video element is a *slave*
// of the master clock managed by useOffsetScheduler — when paused the
// useEffects below sync v.currentTime to the master playhead; when
// playing, the RAF loop in useOffsetScheduler does that work and also
// runs v.play() / v.pause() based on whether master is inside cam-1's
// material range.
import { useEffect, useRef } from "react";
import { useOffsetScheduler } from "../useOffsetScheduler";
import { useEditorStore } from "../store";
import { clipRangeS } from "../types";

interface Props {
  videoUrl: string;
  audioUrl: string;
}

export function VideoCanvas({ videoUrl, audioUrl }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const handle = useOffsetScheduler(videoRef, audioUrl);

  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const seekRequest = useEditorStore((s) => s.playback.seekRequest);
  const clearSeekRequest = useEditorStore((s) => s.clearSeekRequest);
  const setClipDisplayDims = useEditorStore((s) => s.setClipDisplayDims);
  const cam1Id = useEditorStore((s) => s.clips[0]?.id ?? null);
  // Cam-1's master-timeline startS — used to translate master-time
  // (the canonical playhead position) into cam-1's video-file
  // time-domain when paused.
  const cam1StartS = useEditorStore((s) => {
    const cam1 = s.clips[0];
    return cam1 ? clipRangeS(cam1).startS : 0;
  });

  // Report this video's post-rotation natural dims into the store so
  // the output-frame resolver can take them into account. Browser
  // applies any MP4 rotation matrix when populating videoWidth/Height.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !cam1Id) return;
    const report = () => {
      if (v.videoWidth > 0 && v.videoHeight > 0) {
        setClipDisplayDims(cam1Id, v.videoWidth, v.videoHeight);
      }
    };
    v.addEventListener("loadedmetadata", report);
    v.addEventListener("resize", report);
    report();
    return () => {
      v.removeEventListener("loadedmetadata", report);
      v.removeEventListener("resize", report);
    };
  }, [cam1Id, setClipDisplayDims, videoUrl]);

  // Apply external seek while paused. During play the RAF loop in
  // useOffsetScheduler keeps the video synced; this effect is the
  // paused-mode counterpart so the visible frame matches the playhead
  // after seek-back / seek-to-trim-out / etc.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || seekRequest === null) return;
    if (!isPlaying) {
      v.currentTime = Math.max(0, seekRequest - cam1StartS);
    }
    clearSeekRequest();
  }, [seekRequest, cam1StartS, clearSeekRequest, isPlaying]);

  // Compensate for cam1.startS changes (drag-resync or MATCH candidate
  // switch): when the cam's master-timeline anchor moves, adjust
  // v.currentTime so the visible frame still matches the master
  // playhead. While playing the RAF loop already does this — this
  // effect only matters when paused.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) return;
    const masterT = useEditorStore.getState().playback.currentTime;
    const targetT = Math.max(0, masterT - cam1StartS);
    if (Math.abs(v.currentTime - targetT) > 0.04) {
      try {
        v.currentTime = targetT;
      } catch {
        /* element not ready yet — next render */
      }
    }
  }, [cam1StartS, isPlaying]);

  return (
    <div className="relative w-full h-full overflow-hidden">
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        crossOrigin="anonymous"
        preload="auto"
        className="absolute inset-0 w-full h-full"
        style={{ display: "block", objectFit: "contain" }}
      />
      {!handle.isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-sunken/90 text-paper-hi">
          <div className="flex flex-col items-center gap-3">
            <div className="h-2 w-32 rounded-full bg-sunken-soft overflow-hidden">
              <div className="h-full w-1/3 bg-hot animate-pulse" />
            </div>
            <span className="font-mono text-xs text-paper-hi/70 tracking-label uppercase">
              Decoding studio audio
            </span>
            {handle.error && (
              <span className="font-mono text-xs text-danger">
                {handle.error}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
