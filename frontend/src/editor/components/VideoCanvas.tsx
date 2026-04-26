// Muted <video> + Web Audio scheduler. Playback state mirrors the store.
import { useEffect, useRef } from "react";
import { useOffsetScheduler } from "../useOffsetScheduler";
import { useEditorStore } from "../store";

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
  const setPlaying = useEditorStore((s) => s.setPlaying);

  // Apply external play/pause
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (isPlaying) {
      v.play().catch(() => setPlaying(false));
    } else {
      v.pause();
    }
  }, [isPlaying, setPlaying]);

  // Apply external seek
  useEffect(() => {
    const v = videoRef.current;
    if (!v || seekRequest === null) return;
    v.currentTime = seekRequest;
    clearSeekRequest();
  }, [seekRequest, clearSeekRequest]);

  // Reflect intrinsic ended/pause back into the store
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onEnded = () => setPlaying(false);
    v.addEventListener("ended", onEnded);
    return () => v.removeEventListener("ended", onEnded);
  }, [setPlaying]);

  return (
    <div className="relative w-full h-full bg-sunken flex items-center justify-center overflow-hidden">
      <video
        ref={videoRef}
        src={videoUrl}
        muted
        playsInline
        crossOrigin="anonymous"
        preload="auto"
        className="max-h-full max-w-full"
        style={{ display: "block" }}
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
