/**
 * Pure quantize helpers for the Q-hold-to-quantize gesture.
 *
 * `buildQuantizePreview` returns a list of from→to deltas for every
 * off-grid marker (cuts, cam start positions, trim). The Timeline
 * component renders ghost markers at the `to` positions while Q is
 * held; on keyup, `applyQuantizePreview` mutates the store via the
 * provided actions. Esc cancels by simply discarding the preview.
 */
import { snapTime, type SnapMode, type SnapCtx } from "./snap";
import { clipRangeS, type VideoClip } from "./types";
import type { Cut } from "../storage/jobs-db";

const ON_GRID_TOLERANCE_S = 0.001;

export interface QuantizePreview {
  cuts: { from: number; to: number; camId: string }[];
  clipStartOffsets: { camId: string; from: number; to: number }[];
  trim:
    | { from: { in: number; out: number }; to: { in: number; out: number } }
    | null;
}

export interface QuantizeStateSnapshot {
  cuts: Cut[];
  clips: VideoClip[];
  trim: { in: number; out: number };
}

export function buildQuantizePreview(
  state: QuantizeStateSnapshot,
  mode: SnapMode,
  ctx: SnapCtx,
): QuantizePreview {
  // OFF / MATCH have no time-grid → no quantize. (MATCH would mean
  // "snap each marker to a cam-alignment offset" which is conceptually
  // ill-defined for cuts and trim.)
  if (mode === "off" || mode === "match") {
    return emptyPreview();
  }
  if (!ctx.bpm || ctx.bpm <= 0) return emptyPreview();

  // Quantize cuts.
  const cuts: QuantizePreview["cuts"] = [];
  for (const cut of state.cuts) {
    const snapped = snapTime(cut.atTimeS, mode, ctx);
    if (Math.abs(snapped - cut.atTimeS) > ON_GRID_TOLERANCE_S) {
      cuts.push({ from: cut.atTimeS, to: snapped, camId: cut.camId });
    }
  }

  // Quantize cam start positions: snap the clip's masterStartS, then
  // back-solve startOffsetS.
  const clipStartOffsets: QuantizePreview["clipStartOffsets"] = [];
  for (const clip of state.clips) {
    const range = clipRangeS(clip);
    const snappedStart = snapTime(range.startS, mode, ctx);
    if (Math.abs(snappedStart - range.startS) > ON_GRID_TOLERANCE_S) {
      const algoSyncS = (clip.syncOffsetMs + clip.syncOverrideMs) / 1000;
      const newStartOffsetS = snappedStart + algoSyncS;
      clipStartOffsets.push({
        camId: clip.id,
        from: clip.startOffsetS,
        to: newStartOffsetS,
      });
    }
  }

  // Quantize trim independently for in / out.
  let trim: QuantizePreview["trim"] = null;
  const trimInSnapped = snapTime(state.trim.in, mode, ctx);
  const trimOutSnapped = snapTime(state.trim.out, mode, ctx);
  const inOff = Math.abs(trimInSnapped - state.trim.in) > ON_GRID_TOLERANCE_S;
  const outOff =
    Math.abs(trimOutSnapped - state.trim.out) > ON_GRID_TOLERANCE_S;
  if (inOff || outOff) {
    trim = {
      from: { in: state.trim.in, out: state.trim.out },
      to: {
        in: inOff ? trimInSnapped : state.trim.in,
        out: outOff ? trimOutSnapped : state.trim.out,
      },
    };
  }

  return { cuts, clipStartOffsets, trim };
}

export function isPreviewEmpty(p: QuantizePreview): boolean {
  return (
    p.cuts.length === 0 &&
    p.clipStartOffsets.length === 0 &&
    p.trim === null
  );
}

function emptyPreview(): QuantizePreview {
  return { cuts: [], clipStartOffsets: [], trim: null };
}
