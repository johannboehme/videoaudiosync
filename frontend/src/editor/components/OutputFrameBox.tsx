/**
 * Output-Frame-Wrapper für die Live-Preview.
 *
 * Misst den Container, ermittelt cam-1's natural Aspect-Ratio (post-
 * rotation) live aus dem `<video data-cam-master>`-Element, berechnet das
 * Output-Frame-Rechteck (= aspect-fit zentriert), und positioniert
 * Children absolut innerhalb dieses Rechtecks.
 *
 * Children sehen das Output-Frame als ihre `relative` parent-bounds. Eine
 * dünne stroke-Linie zeichnet den Rand des Output-Frames als visueller
 * „so wird gerendert"-Indikator — entkoppelt vom darunter liegenden
 * `<video>`-Stack, der seine eigene letterbox-Darstellung weiterführt.
 */
import { ReactNode, useEffect, useRef, useState } from "react";
import { useEditorStore } from "../store";
import {
  computeOutputFrameBox,
  resolveOutputAspectRatio,
  type OutputFrameBox as Box,
} from "../output-frame";

interface Props {
  children: ReactNode;
  /** When true, draws a 1px outline at the frame boundary so the user
   *  sees where the renderable area ends. Default true. */
  showIndicator?: boolean;
}

const VIDEO_QUERY = "[data-cam-master]";

export function OutputFrameBox({ children, showIndicator = true }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const [cam1AR, setCam1AR] = useState<number | null>(null);
  const exportSpec = useEditorStore((s) => s.exportSpec);

  // Track the container's CSS bounds.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    const update = () => {
      const rect = wrapper.getBoundingClientRect();
      setContainerSize({ width: rect.width, height: rect.height });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(wrapper);
    return () => ro.disconnect();
  }, []);

  // Track cam-1's natural (post-rotation) aspect ratio. The browser
  // applies MP4 rotation metadata when decoding, so videoWidth/Height
  // here equal what the user actually sees in the <video> element.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (!wrapper) return;
    let video: HTMLVideoElement | null = null;
    const findAndAttach = () => {
      const next = wrapper.querySelector<HTMLVideoElement>(VIDEO_QUERY);
      if (next === video) return;
      // Detach old listeners.
      if (video) {
        video.removeEventListener("loadedmetadata", readAR);
        video.removeEventListener("resize", readAR);
      }
      video = next;
      if (video) {
        video.addEventListener("loadedmetadata", readAR);
        video.addEventListener("resize", readAR);
        readAR();
      } else {
        setCam1AR(null);
      }
    };
    function readAR() {
      if (!video) return;
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) setCam1AR(w / h);
    }
    findAndAttach();
    // The cam-master <video> may mount/unmount when clips swap. A simple
    // mutation observer on the wrapper subtree catches that.
    const mo = new MutationObserver(findAndAttach);
    mo.observe(wrapper, { childList: true, subtree: true });
    return () => {
      mo.disconnect();
      if (video) {
        video.removeEventListener("loadedmetadata", readAR);
        video.removeEventListener("resize", readAR);
      }
    };
  }, []);

  const outputAR = resolveOutputAspectRatio({
    resolution: exportSpec.resolution,
    cam1NaturalAR: cam1AR,
  });

  const box: Box | null =
    outputAR && containerSize.width > 0 && containerSize.height > 0
      ? computeOutputFrameBox(outputAR, containerSize)
      : null;

  return (
    <div ref={wrapperRef} className="absolute inset-0 pointer-events-none">
      {box && (
        <div
          className="absolute pointer-events-none"
          style={{
            left: box.left,
            top: box.top,
            width: box.width,
            height: box.height,
          }}
        >
          {/* Faint stroke so the user sees where the renderable area ends.
           *  Subtle on purpose — never obstructs the video underneath. */}
          {showIndicator && (
            <div
              aria-hidden
              className="absolute inset-0 pointer-events-none"
              style={{
                outline: "1px dashed rgba(255,255,255,0.18)",
                outlineOffset: -1,
              }}
            />
          )}
          {children}
        </div>
      )}
    </div>
  );
}
