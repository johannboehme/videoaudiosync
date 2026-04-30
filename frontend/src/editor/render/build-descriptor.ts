/**
 * Pure builder: store snapshot + master-time → `FrameDescriptor`.
 *
 * Used by:
 *   - `PreviewRuntime` on every RAF tick to drive the backend.
 *   - Tests, which can call this without a Zustand store / React tree.
 *   - Export-side wrapper (Schritt 8) which re-uses the layer/fx logic
 *     but supplies its own intrinsic-rotation map for source frames.
 *
 * No side effects, no DOM access. Returns a fresh descriptor on every
 * call — caller decides about diffing.
 */
import type { Clip, ExportSpec } from "../types";
import { clipRangeS, isImageClip, normaliseRotation } from "../types";
import type { Cut } from "../../storage/jobs-db";
import type { PunchFx } from "../fx/types";
import { activeCamAt, type CamRange } from "../cuts";
import { activeFxAt } from "../fx/active";
import { fxCatalog } from "../fx/catalog";
import { camSourceTimeS } from "../../local/timing/cam-time";
import { resolveOutputDims } from "../output-frame";
import type {
  FitRect,
  FrameDescriptor,
  FrameFx,
  FrameLayer,
  OutputDims,
} from "./frame-descriptor";

/** Minimal store-snapshot shape the builder needs. Lets tests construct
 *  inputs without instantiating the full Zustand store. */
export interface EditorStoreSnapshot {
  clips: readonly Clip[];
  cuts: readonly Cut[];
  fx: readonly PunchFx[];
  exportSpec: ExportSpec;
}

/**
 * Build a descriptor for the LIVE PREVIEW.
 *
 * Source assumption: `<video>` elements supplied at draw time have the
 * intrinsic MP4 rotation matrix already applied by the browser (i.e.
 * `videoWidth/Height` already swapped). So `rotationDeg` here is the
 * USER rotation only. The export builder (Schritt 8) takes a different
 * code path that adds the intrinsic on top.
 */
export function buildPreviewFrameDescriptor(
  snapshot: EditorStoreSnapshot,
  tMaster: number,
): FrameDescriptor {
  const output = computeOutputSnapped(snapshot.clips, snapshot.exportSpec.resolution);
  const fxOut = buildFx(snapshot.fx, tMaster);

  if (!output) {
    return { tMaster, output: null, layers: [], fx: fxOut };
  }

  const ranges: CamRange[] = computeCamRanges(snapshot.clips);
  const activeId = activeCamAt(snapshot.cuts, tMaster, ranges);
  const layers = activeId
    ? buildPreviewLayers(snapshot.clips, activeId, tMaster, output)
    : [];

  return { tMaster, output, layers, fx: fxOut };
}

// ---------- internals ----------

function computeCamRanges(clips: readonly Clip[]): CamRange[] {
  return clips.map((c) => {
    const r = clipRangeS(c);
    return { id: c.id, startS: r.startS, endS: r.endS };
  });
}

function computeOutputSnapped(
  clips: readonly Clip[],
  resolution: ExportSpec["resolution"],
): OutputDims | null {
  const raw = resolveOutputDims(clips, resolution);
  if (!raw) return null;
  return { w: Math.round(raw.w), h: Math.round(raw.h) };
}

function buildPreviewLayers(
  clips: readonly Clip[],
  activeId: string,
  tMaster: number,
  output: OutputDims,
): FrameLayer[] {
  const clip = clips.find((c) => c.id === activeId);
  if (!clip) return [];

  // Preview source = `<video>` (post-intrinsic) or `<img>` — already
  // post-intrinsic. User rotation is what the backend applies.
  const userRot = normaliseRotation(clip.rotation);
  const flipX = !!clip.flipX;
  const flipY = !!clip.flipY;

  // displayW/H = the source pixel buffer's dimensions after USER rotation.
  // For preview the `<video>` reports videoWidth = post-intrinsic; the
  // store mirrors that into clip.displayW/H. After USER rotation 90/270
  // we swap.
  const baseW = clip.displayW ?? 0;
  const baseH = clip.displayH ?? 0;
  if (baseW <= 0 || baseH <= 0) return [];
  const swap = userRot === 90 || userRot === 270;
  const dispW = swap ? baseH : baseW;
  const dispH = swap ? baseW : baseH;

  const fitRect = computeFitRect(dispW, dispH, output.w, output.h);

  const source = isImageClip(clip)
    ? { kind: "image" as const, clipId: clip.id }
    : {
        kind: "video" as const,
        clipId: clip.id,
        sourceTimeS: camSourceTimeS(tMaster, {
          masterStartS: clipRangeS(clip).anchorS,
          driftRatio: clip.driftRatio,
        }),
        sourceDurS: clip.sourceDurationS,
      };

  return [
    {
      layerId: clip.id,
      source,
      weight: 1,
      fitRect,
      rotationDeg: userRot,
      flipX,
      flipY,
      displayW: dispW,
      displayH: dispH,
    },
  ];
}

function buildFx(fx: readonly PunchFx[], tMaster: number): FrameFx[] {
  const active = activeFxAt(fx, tMaster);
  return active.map((f) => {
    const def = fxCatalog[f.kind];
    return {
      id: f.id,
      kind: f.kind,
      params: { ...def.defaultParams, ...(f.params ?? {}) },
    };
  });
}

/** Letterbox/pillarbox fit — same shape as compositor.ts's helper but
 *  exposed here so the descriptor stays self-contained. Integer-pixel
 *  snapped to keep parity with OutputFrameBox's CSS rounding. */
export function computeFitRect(
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): FitRect {
  if (srcW <= 0 || srcH <= 0 || dstW <= 0 || dstH <= 0) {
    return { x: 0, y: 0, w: 0, h: 0 };
  }
  const srcAspect = srcW / srcH;
  const dstAspect = dstW / dstH;
  if (Math.abs(srcAspect - dstAspect) < 1e-3) {
    return { x: 0, y: 0, w: dstW, h: dstH };
  }
  if (srcAspect > dstAspect) {
    // Source wider → fit width, letterbox top/bottom.
    const h = dstW / srcAspect;
    return { x: 0, y: (dstH - h) / 2, w: dstW, h };
  }
  // Source taller → fit height, pillarbox left/right.
  const w = dstH * srcAspect;
  return { x: (dstW - w) / 2, y: 0, w, h: dstH };
}
