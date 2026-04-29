/**
 * Output-Frame-Wrapper für die Live-Preview.
 *
 * Misst den umgebenden Container (CSS-pixel) und kombiniert die mit der
 * vom Store aufgelösten Output-Aspect-Ratio. Children werden absolut
 * innerhalb des berechneten Output-Rechtecks positioniert.
 *
 * Es gibt keinen "Master-Cam" mehr — die AR kommt aus dem `clips`-Array
 * (jede `displayW/displayH` reportet sich selbst, sobald die Metadaten
 * geladen sind) plus der `exportSpec.resolution`. Der `<video>`-Stack
 * sitzt INNERHALB der Box und wird hier nicht mehr abgefragt.
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

export function OutputFrameBox({ children, showIndicator = true }: Props) {
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const exportSpec = useEditorStore((s) => s.exportSpec);
  const clips = useEditorStore((s) => s.clips);

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

  const outputAR = resolveOutputAspectRatio({
    resolution: exportSpec.resolution,
    clips,
  });

  // Bootstrap problem: children include the <video> elements that report
  // their natural dims into the store, which is what we use to compute
  // the box. So children must mount *before* a box is known. While the
  // dims are still arriving we fall back to the full container; once a
  // dim is available we shrink to the bounding-box rectangle.
  const rawBox: Box =
    outputAR && containerSize.width > 0 && containerSize.height > 0
      ? computeOutputFrameBox(outputAR, containerSize)
      : { left: 0, top: 0, width: containerSize.width, height: containerSize.height };
  // Snap to integer pixels so the FX canvas, the <video>, and the
  // dashed indicator all align exactly. Subpixel float widths cause
  // the browser to rasterize children inconsistently — the FX canvas
  // would land one pixel short of the video, leaving a hairline
  // unaffected stripe at the edge.
  const box: Box = {
    left: Math.round(rawBox.left),
    top: Math.round(rawBox.top),
    width: Math.round(rawBox.width),
    height: Math.round(rawBox.height),
  };
  const boxResolved = outputAR !== null;

  return (
    <div ref={wrapperRef} className="absolute inset-0 pointer-events-none">
      <div
        className="absolute pointer-events-none"
        style={{
          left: box.left,
          top: box.top,
          width: box.width,
          height: box.height,
        }}
      >
        {showIndicator && boxResolved && (
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
    </div>
  );
}
