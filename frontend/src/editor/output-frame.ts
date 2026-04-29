/**
 * Output-Frame-Berechnung für Live-Preview und Render-Pipeline.
 *
 * Es gibt keinen "Master-Cam". Der Output-Frame ist eine Bounding-Box
 * `(max(W_i), max(H_i))` über alle Clip-Display-Dims, sodass kein cam
 * jemals abgeschnitten wird. Cams mit anderer Aspect-Ratio werden
 * innerhalb der Box letterboxed/pillarboxed (`computeFitRect`-Helper im
 * Compositor). Wenn die User-ExportSpec eine explizite Resolution
 * vorgibt, gewinnt die.
 *
 * Future: zusätzliche transparente Lanes (Alpha-Overlays über der
 * aktiven Cam) werden ebenfalls in dieselbe Box gefittet — der FX-
 * Overlay sitzt darüber on top.
 */
import type { Clip } from "./types";
import { clipEffectiveDisplayDims } from "./types";
import type { ExportSpec } from "./types";

export interface OutputFrameBox {
  /** Position des Output-Frames innerhalb des Containers (CSS-pixel). */
  left: number;
  top: number;
  /** Größe des Output-Frames (CSS-pixel). */
  width: number;
  height: number;
}

export interface OutputDims {
  w: number;
  h: number;
}

/**
 * Bestimmt die intendierten Output-Dimensionen.
 *
 * Wenn die ExportSpec eine explizite Resolution gesetzt hat → die.
 * Sonst: Bounding-Box `(max W, max H)` über alle Clips, die bereits
 * `displayW/displayH` reportet haben. Returns `null` solange noch kein
 * Clip seine dims gemeldet hat (caller hält die FxOverlay zurück).
 */
export function resolveOutputDims(
  clips: readonly Clip[],
  resolution: ExportSpec["resolution"],
): OutputDims | null {
  if (
    resolution &&
    resolution !== "source" &&
    resolution.w > 0 &&
    resolution.h > 0
  ) {
    return { w: resolution.w, h: resolution.h };
  }
  let maxW = 0;
  let maxH = 0;
  for (const c of clips) {
    const dims = clipEffectiveDisplayDims(c);
    if (dims) {
      if (dims.w > maxW) maxW = dims.w;
      if (dims.h > maxH) maxH = dims.h;
    }
  }
  if (maxW <= 0 || maxH <= 0) return null;
  return { w: maxW, h: maxH };
}

/** Convenience for callers that only care about the AR. */
export function resolveOutputAspectRatio(args: {
  resolution: ExportSpec["resolution"];
  clips: readonly Clip[];
}): number | null {
  const dims = resolveOutputDims(args.clips, args.resolution);
  if (!dims) return null;
  return dims.w / dims.h;
}

/**
 * Berechnet das Output-Frame-Rechteck — aspect-fit, zentriert in den
 * Container. Für eine Output-AR > Container-AR (z.B. 16:9 in 21:9):
 * letterbox top/bottom. Für Output-AR < Container-AR: pillarbox links/
 * rechts. AR-Match: füllt den Container.
 */
export function computeOutputFrameBox(
  outputAspect: number,
  container: { width: number; height: number },
): OutputFrameBox {
  const cw = Math.max(0, container.width);
  const ch = Math.max(0, container.height);
  if (outputAspect <= 0 || cw === 0 || ch === 0) {
    return { left: 0, top: 0, width: cw, height: ch };
  }
  const containerAspect = cw / ch;
  if (Math.abs(containerAspect - outputAspect) < 1e-3) {
    return { left: 0, top: 0, width: cw, height: ch };
  }
  if (outputAspect > containerAspect) {
    // Container relatively taller → output letterboxes top/bottom.
    const w = cw;
    const h = w / outputAspect;
    return {
      left: 0,
      top: (ch - h) / 2,
      width: w,
      height: h,
    };
  }
  // Output relatively taller → output pillarboxes left/right.
  const h = ch;
  const w = h * outputAspect;
  return {
    left: (cw - w) / 2,
    top: 0,
    width: w,
    height: h,
  };
}
