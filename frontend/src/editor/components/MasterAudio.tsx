/**
 * Owns the master `<audio>` element. Drives the editor's master clock via
 * `useAudioMaster` — every cam in the preview is a passive slave of the
 * store's `playback.currentTime`, which this component keeps mirrored to
 * the audio element's currentTime.
 *
 * Visually invisible (display:none). The element is only here for the
 * decode + playback pipeline; the user listens to the resulting audio.
 */
import { useRef } from "react";
import { useAudioMaster } from "../useAudioMaster";

interface Props {
  audioUrl: string;
}

export function MasterAudio({ audioUrl }: Props) {
  const ref = useRef<HTMLAudioElement>(null);
  const handle = useAudioMaster(ref, audioUrl);
  return (
    <>
      <audio
        ref={ref}
        src={audioUrl}
        preload="auto"
        crossOrigin="anonymous"
        data-testid="master-audio"
        style={{ display: "none" }}
      />
      {!handle.isReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-sunken/90 text-paper-hi pointer-events-none">
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
    </>
  );
}
