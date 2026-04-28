/**
 * PROGRAM-Strip — the "golden path" above the lanes.
 *
 * Looks like a piece of brushed-metal magnetic tape running across the
 * timeline. The active cam at each time is shown as an inset colored
 * segment — like painted leader tape. Cuts appear as small brass splice
 * tabs between two segments.
 *
 * Future-proof: the strip will also carry beat/bar tick marks (Schritt 1
 * lays down the visual frame; the marks themselves come later). The
 * sprocket-hole row at the top is the natural place for those ticks.
 */
import { CSSProperties, MouseEvent, useMemo, useState } from "react";
import type { Cut } from "../../../storage/jobs-db";
import { activeCamAt } from "../../cuts";

interface CamLookup {
  id: string;
  color: string;
  range: { startS: number; endS: number };
}

interface Props {
  cuts: readonly Cut[];
  cams: readonly CamLookup[];
  /** Master timeline duration in seconds (for unzoomed coverage). */
  duration: number;
  viewStartS: number;
  viewEndS: number;
  width: number;
  height?: number;
  /** Called when the user clicks the × on a hovered splice to delete it. */
  onRemoveCut?: (atTimeS: number, camId: string) => void;
  /** Live paint preview for an active hold gesture in paint mode. Renders
   * a translucent cam-color wash from `fromS` to the playhead and a
   * pulsing "head" at the leading edge — the on-air tape recorder vibe. */
  paintPreview?: {
    fromS: number;
    toS: number;
    color: string;
    camLabel: string;
  } | null;
}

const TAPE_HEIGHT = 32;
const SPROCKET_PITCH = 14;

export function ProgramStrip({
  cuts,
  cams,
  duration,
  viewStartS,
  viewEndS,
  width,
  height = TAPE_HEIGHT,
  onRemoveCut,
  paintPreview,
}: Props) {
  const [hoveredCut, setHoveredCut] = useState<{ atTimeS: number; camId: string } | null>(null);
  // Compute the program — a flat list of {startS, endS, color} segments
  // covering [0, duration]. Each segment ends where the active cam changes
  // (either via a cut or because the chosen cam runs out of material and
  // activeCamAt falls back).
  const segments = useMemo(
    () => buildProgram(cuts, cams, duration),
    [cuts, cams, duration],
  );

  const visibleSpan = Math.max(1e-6, viewEndS - viewStartS);
  const tToX = (t: number) => ((t - viewStartS) / visibleSpan) * width;

  // Sprocket dots scale with width.
  const dotCount = Math.max(0, Math.floor(width / SPROCKET_PITCH));

  const tapeStyle: CSSProperties = {
    background: `
      repeating-linear-gradient(90deg, transparent 0, transparent 1.5px, rgba(0,0,0,0.05) 1.6px, transparent 2.2px),
      linear-gradient(180deg, #C8BC9A 0%, #D6CCAE 35%, #BFB18C 100%)
    `,
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.5), inset 0 -1px 0 rgba(0,0,0,0.25), 0 1px 1px rgba(0,0,0,0.08)",
    height,
  };

  return (
    <div
      className="relative w-full overflow-hidden border-y border-[#9F9170] select-none"
      style={tapeStyle}
    >
      {/* Sprocket-hole row along the top edge */}
      <div className="absolute top-0 left-0 right-0 h-[8px] flex items-center justify-around pointer-events-none">
        {Array.from({ length: dotCount }).map((_, i) => (
          <span
            key={i}
            className="block w-[3px] h-[3px] rounded-full"
            style={{
              background: "#3A352E",
              boxShadow: "0 1px 0 rgba(255,255,255,0.45), inset 0 0 1px rgba(0,0,0,0.4)",
            }}
          />
        ))}
      </div>

      {/* Cam-color program segments — inset like painted leader tape */}
      <div className="absolute left-0 right-0 top-[10px] bottom-[3px] overflow-hidden">
        {segments.map((seg, i) => {
          const x1 = tToX(seg.startS);
          const x2 = tToX(seg.endS);
          if (x2 < 0 || x1 > width) return null;
          const left = Math.max(0, x1);
          const right = Math.min(width, x2);
          if (right <= left) return null;
          if (seg.color === null) {
            // No-cam segment — show as the bare tape, no painted strip
            return null;
          }
          return (
            <div
              key={i}
              className="absolute top-0 bottom-0"
              style={{
                left,
                width: right - left,
                background: `linear-gradient(180deg, ${seg.color} 0%, ${seg.color} 50%, ${darken(seg.color, 0.18)} 100%)`,
                boxShadow:
                  "inset 0 1px 1px rgba(255,255,255,0.4), inset 0 -1px 1px rgba(0,0,0,0.28)",
              }}
              title={`${seg.startS.toFixed(2)}s — ${seg.endS.toFixed(2)}s`}
            />
          );
        })}
      </div>

      {/* Live paint preview — translucent wash from press start to current
        * playhead, plus a pulsing "head" at the leading edge. Sits above
        * the cam-color program segments so the user sees what their hold
        * gesture will commit on release. */}
      {paintPreview && (() => {
        const lo = Math.min(paintPreview.fromS, paintPreview.toS);
        const hi = Math.max(paintPreview.fromS, paintPreview.toS);
        const x1 = tToX(lo);
        const x2 = tToX(hi);
        if (x2 <= 0 || x1 >= width) return null;
        const left = Math.max(0, x1);
        const right = Math.min(width, x2);
        const headIsRight = paintPreview.toS >= paintPreview.fromS;
        return (
          <>
            <div
              className="absolute pointer-events-none"
              style={{
                left,
                width: right - left,
                top: 9,
                bottom: 3,
                background: `linear-gradient(180deg, ${paintPreview.color}cc 0%, ${paintPreview.color} 50%, ${darken(paintPreview.color, 0.18)}cc 100%)`,
                boxShadow:
                  "inset 0 1px 1px rgba(255,255,255,0.55), inset 0 -1px 1px rgba(0,0,0,0.32), 0 0 6px rgba(255,51,38,0.45)",
              }}
            />
            {/* Leading edge — the "tape recorder head" */}
            <div
              className="absolute pointer-events-none"
              style={{
                left: (headIsRight ? right : left) - 1,
                top: 5,
                bottom: -1,
                width: 2,
                background: "#FFF",
                boxShadow: `0 0 6px ${paintPreview.color}, 0 0 10px rgba(255,51,38,0.7)`,
                animation: "vas-paint-head 0.7s ease-in-out infinite",
              }}
            />
            {/* "REC · CAM N" badge floating above the head */}
            <div
              className="absolute font-display font-semibold text-[9px] tracking-label uppercase pointer-events-none"
              style={{
                left: Math.max(2, Math.min(width - 60, (headIsRight ? right : left) - 28)),
                top: -16,
                color: "#FF3326",
                textShadow: "0 0 6px rgba(255,51,38,0.8), 0 1px 0 rgba(0,0,0,0.25)",
                whiteSpace: "nowrap",
              }}
            >
              ● REC · {paintPreview.camLabel}
            </div>
          </>
        );
      })()}

      {/* Brass splice tabs at every cut. Hover lifts the tab + reveals an
        * × button for delete. The tab itself stays clickable as part of
        * the same hit area so the user can grab it from anywhere on it. */}
      {cuts.map((cut, i) => {
        const x = tToX(cut.atTimeS);
        if (x < -8 || x > width + 8) return null;
        const isHovered =
          hoveredCut !== null &&
          hoveredCut.atTimeS === cut.atTimeS &&
          hoveredCut.camId === cut.camId;
        return (
          <SpliceTab
            key={`${cut.atTimeS}-${cut.camId}-${i}`}
            x={x}
            height={height}
            hovered={isHovered}
            onEnter={() => setHoveredCut({ atTimeS: cut.atTimeS, camId: cut.camId })}
            onLeave={() => setHoveredCut(null)}
            onDelete={(e) => {
              e.stopPropagation();
              onRemoveCut?.(cut.atTimeS, cut.camId);
              setHoveredCut(null);
            }}
          />
        );
      })}
    </div>
  );
}

function SpliceTab({
  x,
  height,
  hovered,
  onEnter,
  onLeave,
  onDelete,
}: {
  x: number;
  height: number;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onDelete: (e: MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div
      // Hit area is wider than the visible tab so it's tappable even on touch.
      className="absolute top-[-2px]"
      style={{
        left: x - 8,
        width: 16,
        height: height + 4,
        cursor: "pointer",
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {/* Visible brass tab. When hovered, lift it ~6 px above the strip so
        * the × button has somewhere to live without being clipped. */}
      <div
        className="absolute pointer-events-none transition-transform duration-100"
        style={{
          left: 6,
          width: 4,
          top: 7,
          height: height - 9,
          background:
            "linear-gradient(180deg, #F0D079 0%, #C99A3B 50%, #F0D079 100%)",
          boxShadow:
            "0 0 2px rgba(0,0,0,0.45), inset 0 0 1px rgba(255,255,255,0.55)",
          borderRadius: 1,
          transform: hovered ? "translateY(-6px)" : "translateY(0)",
        }}
      >
        <span
          className="absolute left-[1px] right-[1px] top-[2px] h-[1px] block"
          style={{ background: "rgba(0,0,0,0.45)" }}
        />
        <span
          className="absolute left-[1px] right-[1px] bottom-[2px] h-[1px] block"
          style={{ background: "rgba(0,0,0,0.45)" }}
        />
      </div>

      {/* Delete button — appears above the lifted tab when hovered. */}
      {hovered && (
        <button
          type="button"
          onClick={onDelete}
          aria-label="Remove cut"
          className="absolute z-10 flex items-center justify-center rounded-full bg-paper-hi border border-rule shadow text-ink-2 hover:text-danger hover:border-danger font-mono leading-none"
          style={{
            left: 0,
            top: -2,
            width: 16,
            height: 16,
            fontSize: 11,
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

interface ProgramSegment {
  startS: number;
  endS: number;
  /** null = no cam active (will render as bare tape → preview shows test pattern) */
  color: string | null;
}

/**
 * Walk the master timeline from 0 to `duration`, sampling activeCamAt at
 * every cut boundary + every cam-range boundary. Coalesce consecutive
 * samples into segments.
 *
 * Pure: kept inside this file because the data shape (CamLookup includes
 * the color) is UI-specific. The cuts.ts resolver handles the active-cam
 * resolution itself.
 */
function buildProgram(
  cuts: readonly Cut[],
  cams: readonly CamLookup[],
  duration: number,
): ProgramSegment[] {
  if (duration <= 0) return [];

  // Collect interesting timestamps: 0, every cut atTimeS, every cam start/end
  // (clamped to [0, duration]), and `duration`.
  const ts = new Set<number>([0, duration]);
  for (const c of cuts) ts.add(clamp(c.atTimeS, 0, duration));
  for (const cam of cams) {
    ts.add(clamp(cam.range.startS, 0, duration));
    ts.add(clamp(cam.range.endS, 0, duration));
  }
  const sorted = [...ts].filter((t) => t >= 0 && t <= duration).sort((a, b) => a - b);

  const camRanges = cams.map((c) => ({
    id: c.id,
    startS: c.range.startS,
    endS: c.range.endS,
  }));
  const colorById = new Map(cams.map((c) => [c.id, c.color] as const));

  const segments: ProgramSegment[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const t = sorted[i];
    const tNext = sorted[i + 1];
    if (tNext - t < 1e-9) continue;
    // Sample mid-point so we land cleanly inside a region (avoids ambiguity
    // exactly at a boundary where startS is inclusive and endS exclusive).
    const sampleT = (t + tNext) / 2;
    const camId = activeCamAt(cuts, sampleT, camRanges);
    const color = camId === null ? null : colorById.get(camId) ?? null;

    if (segments.length > 0 && segments[segments.length - 1].color === color) {
      segments[segments.length - 1].endS = tNext;
    } else {
      segments.push({ startS: t, endS: tNext, color });
    }
  }
  return segments;
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

function darken(hex: string, fraction: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.round(parseInt(c.slice(0, 2), 16) * (1 - fraction));
  const g = Math.round(parseInt(c.slice(2, 4), 16) * (1 - fraction));
  const b = Math.round(parseInt(c.slice(4, 6), 16) * (1 - fraction));
  return `#${[r, g, b].map((n) => Math.max(0, n).toString(16).padStart(2, "0")).join("")}`;
}
