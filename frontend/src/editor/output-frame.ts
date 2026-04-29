/**
 * Output-Frame-Berechnung für die Live-Preview.
 *
 * Im Render heute (siehe `local/render/edit.ts:570-582`) ist das Output-
 * Frame standardmäßig die *displayed* (post-rotation) Dimension von cam-1.
 * Wenn der User in der ExportSpec eine explizite Resolution gesetzt hat,
 * gewinnt die. Alle anderen Cams werden in dieses Frame letterbox/
 * pillarbox-gefitted (`computeFitRect` im Compositor).
 *
 * Im Live-Preview hatten wir das nicht abgebildet — der `<video>`-Container
 * füllt die EditorShell-Spalte (z.B. 21:9), und die FxOverlay malte über
 * den GANZEN Container statt nur über das eigentliche Output-Frame. Bei
 * Hochkant-Cam-1 in einem Widescreen-Editor war die Vignette dann auf
 * die schwarzen Side-Bars appliziert — visuell falsch, weil der Renderer
 * diese Bereiche gar nicht rausschreibt.
 *
 * Diese Helper berechnen:
 *   1. die intendierte Output-AR (aus dem Editor-Store)
 *   2. das aspect-fit Rectangle innerhalb eines gegebenen Container-Bounds
 */
import type { ExportSpec } from "./types";

export interface OutputFrameBox {
  /** Position des Output-Frames innerhalb des Containers (CSS-pixel). */
  left: number;
  top: number;
  /** Größe des Output-Frames (CSS-pixel). */
  width: number;
  height: number;
}

/**
 * Bestimmt die intendierte Output-Aspect-Ratio.
 *
 * Wenn die ExportSpec eine explizite Resolution gesetzt hat → die.
 * Sonst fällt der Renderer auf cam-1's *displayed* (post-rotation)
 * Dimension zurück — die ist im Live-Preview vom `<video>`-Element
 * via `videoWidth`/`videoHeight` ablesbar (Browser correctiert für
 * MP4-Rotation-Metadaten beim Decode). Caller liest das selbst aus
 * dem aktiven `<video>`-Ref und übergibt es als `cam1NaturalAR`.
 *
 * `jobMeta.width`/`height` aus der Storage sind die *encoded* Dimens-
 * ionen (vor Rotation) und liefern das falsche AR bei Hochkant-Phone-
 * Aufnahmen — daher reichen wir den Live-Wert durch.
 */
export function resolveOutputAspectRatio(args: {
  resolution: ExportSpec["resolution"];
  cam1NaturalAR: number | null;
}): number | null {
  const { resolution, cam1NaturalAR } = args;
  if (
    resolution &&
    resolution !== "source" &&
    resolution.w > 0 &&
    resolution.h > 0
  ) {
    return resolution.w / resolution.h;
  }
  if (cam1NaturalAR && cam1NaturalAR > 0) return cam1NaturalAR;
  return null;
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
