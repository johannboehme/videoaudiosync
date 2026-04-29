/**
 * Multi-cam preview surface.
 *
 * The master AUDIO drives the editor's clock — the `<MasterAudio>` child
 * mounts the studio audio element and `useAudioMaster` mirrors its
 * currentTime into the store. Every cam below is a passive slave: each
 * `CamCanvas` (or `ImageOverlay`) reads `playback.currentTime` and seeks
 * its own media to the corresponding source-time.
 *
 * Removing the first cam, dropping all cams entirely, or having an image
 * cam at index 0 is fine — none of those mutates the clock. The audio
 * keeps playing through the master timeline and the FX overlay continues
 * over whatever cam (if any) is currently active.
 */
import { useEffect, useRef } from "react";
import { useEditorStore } from "../store";
import { isVideoClip, normaliseRotation, type ImageClip } from "../types";
import { TestPattern } from "./TestPattern";
import { CamCanvas } from "./CamCanvas";
import { MasterAudio } from "./MasterAudio";
import { FxOverlay } from "./FxOverlay";
import { OutputFrameBox } from "./OutputFrameBox";

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

  // No cam is "the master" — pick the visible programme cam from the
  // active-cam selector. If nothing has material at currentTime,
  // TestPattern fills the box.
  const showTestPattern = activeCamId === null;

  // Layer order (back → front):
  //   1. each cam — videos always mounted (so the browser keeps decoding
  //      across cuts), display:none when not the active programme cam,
  //   2. FX overlay (transparent canvas, on top of everything),
  //   3. test pattern when no cam has material.
  // The master <audio> sits OUTSIDE OutputFrameBox — it's invisible,
  // its sole purpose is decoded playback.
  return (
    <div className="relative w-full h-full bg-sunken overflow-hidden">
      <MasterAudio audioUrl={audioUrl} />

      {showTestPattern && (
        <div className="absolute inset-0">
          <TestPattern />
        </div>
      )}

      <OutputFrameBox>
        {clips.map((clip) => {
          const url = cams[clip.id]?.videoUrl;
          if (!url) return null;
          if (isVideoClip(clip)) {
            return (
              <CamCanvas
                key={clip.id}
                videoUrl={url}
                visible={activeCamId === clip.id}
                clip={clip}
              />
            );
          }
          return (
            <ImageOverlay
              key={clip.id}
              imageUrl={url}
              visible={activeCamId === clip.id}
              clip={clip}
            />
          );
        })}

        <FxOverlay />
      </OutputFrameBox>
    </div>
  );
}

interface ImageOverlayProps {
  imageUrl: string;
  visible: boolean;
  clip: ImageClip;
}

/** Static image clip — shown as the programme source while it's the active
 *  cam. Object-contained so portrait/landscape images don't get squished. */
function ImageOverlay({ imageUrl, visible, clip }: ImageOverlayProps) {
  const ref = useRef<HTMLImageElement>(null);
  const setClipDisplayDims = useEditorStore((s) => s.setClipDisplayDims);
  useEffect(() => {
    const img = ref.current;
    if (!img) return;
    const report = () => {
      if (img.naturalWidth > 0 && img.naturalHeight > 0) {
        setClipDisplayDims(clip.id, img.naturalWidth, img.naturalHeight);
      }
    };
    if (img.complete) report();
    img.addEventListener("load", report);
    return () => img.removeEventListener("load", report);
  }, [clip.id, setClipDisplayDims, imageUrl]);
  const rot = normaliseRotation(clip.rotation);
  const sx = clip.flipX ? -1 : 1;
  const sy = clip.flipY ? -1 : 1;
  const transform =
    rot === 0 && sx === 1 && sy === 1
      ? undefined
      : `rotate(${rot}deg) scale(${sx}, ${sy})`;
  return (
    <img
      ref={ref}
      src={imageUrl}
      alt={clip.filename}
      className="absolute inset-0 w-full h-full"
      style={{
        display: visible ? "block" : "none",
        objectFit: "contain",
        background: "#1A1816",
        transform,
        transformOrigin: "center center",
      }}
    />
  );
}
