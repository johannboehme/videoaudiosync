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
import {
  CSSProperties,
  MouseEvent,
  PointerEvent as ReactPointerEvent,
  useMemo,
  useRef,
  useState,
} from "react";
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
  /** Called continuously while the user drags a splice tab. Receives the
   *  raw new master-time and the modifier-key state; the parent applies
   *  snap (or not) and returns the time the cut actually committed to
   *  so we can use it as the next drag-tick's identity. */
  onCutDrag?: (
    fromAtTimeS: number,
    camId: string,
    rawNewAtTimeS: number,
    e: { shiftKey: boolean },
  ) => number;
  /** Live paint preview for an active hold gesture in paint mode. Renders
   * a translucent cam-color wash from `fromS` to the playhead and a
   * pulsing "head" at the leading edge — the on-air tape recorder vibe. */
  paintPreview?: {
    fromS: number;
    toS: number;
    color: string;
    camLabel: string;
  } | null;
  /** Match-snap candidates surfaced for the user — tall ticks across the
   *  tape so they're visible during a clip-drag in MATCH mode. Coloured
   *  entirely by confidence (red→amber→green heatmap); cam attribution
   *  is implicit because the user is dragging exactly one cam. */
  matchMarkers?: ReadonlyArray<{
    /** Master-timeline time (seconds) where the candidate would land
     *  the dragging clip's start. */
    t: number;
    /** 0..1 confidence — drives the heatmap colour and the badge text. */
    confidence: number;
    /** Whether this is the currently selected candidate (highlight). */
    isPrimary: boolean;
  }>;
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
  onCutDrag,
  paintPreview,
  matchMarkers,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Drag state for moving an existing cut. Tracks the cut's *current*
   *  master-time (which evolves on every pointer-move tick) plus the
   *  grab-offset so the cursor stays anchored to the same point on the
   *  tab. The state lives here (not in SpliceTab) because the cut's
   *  atTimeS — and therefore the SpliceTab's React key — changes during
   *  the drag; a remount would otherwise drop the pointer capture. */
  const dragCutRef = useRef<{
    camId: string;
    currentT: number;
    grabOffsetT: number;
  } | null>(null);

  const beginCutDrag = (cut: Cut, e: ReactPointerEvent<HTMLElement>) => {
    if (!onCutDrag) return;
    if (!containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const visibleSpan = Math.max(1e-6, viewEndS - viewStartS);
    const pointerT = viewStartS + ((e.clientX - rect.left) / width) * visibleSpan;
    dragCutRef.current = {
      camId: cut.camId,
      currentT: cut.atTimeS,
      grabOffsetT: pointerT - cut.atTimeS,
    };

    const onMove = (ev: PointerEvent) => {
      const drag = dragCutRef.current;
      if (!drag || !containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const newPointerT = viewStartS + ((ev.clientX - r.left) / width) * visibleSpan;
      const requestedT = newPointerT - drag.grabOffsetT;
      const committedT = onCutDrag(drag.currentT, drag.camId, requestedT, {
        shiftKey: ev.shiftKey,
      });
      drag.currentT = committedT;
    };
    const onUp = () => {
      dragCutRef.current = null;
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };
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
      ref={containerRef}
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

      {/* Match-snap candidate markers — shown over the tape during a
       * clip-drag in MATCH mode. The user already knows which cam they're
       * dragging (it's the one under their finger), so the marker itself
       * is colored entirely by *confidence* (red→amber→green heatmap):
       * cam attribution is irrelevant here. Numeric badges show the
       * percentage; if two markers are too close, the lower-confidence
       * label is hidden so they never overlap. */}
      {matchMarkers && matchMarkers.length > 0 &&
        (() => {
          // Pre-compute screen positions and sort by x so we can do a
          // single-pass collision check on the percent labels.
          const items = matchMarkers
            .map((m, i) => {
              const x = tToX(m.t);
              return { m, i, x };
            })
            .filter(({ x }) => x >= -10 && x <= width + 10)
            .sort((a, b) => a.x - b.x);
          const LABEL_W = 22;
          const LABEL_GAP = 2;
          // Hide the label of any marker whose label box would intersect
          // a higher-confidence neighbour. Primary always wins.
          const showLabel = new Array<boolean>(items.length).fill(true);
          for (let a = 0; a < items.length; a++) {
            for (let b = a + 1; b < items.length; b++) {
              if (Math.abs(items[a].x - items[b].x) > LABEL_W + LABEL_GAP) break;
              const aWins =
                items[a].m.isPrimary ||
                (!items[b].m.isPrimary &&
                  items[a].m.confidence >= items[b].m.confidence);
              if (aWins) showLabel[b] = false;
              else showLabel[a] = false;
            }
          }
          return items.map(({ m, i, x }, listIdx) => {
            const headSize = m.isPrimary ? 11 : 8;
            const minLeft = headSize / 2 + 1;
            const maxLeft = width - headSize / 2 - 1;
            const xClamped = Math.max(minLeft, Math.min(maxLeft, x));
            const tickW = m.isPrimary ? 3 : 2;
            const conf = Math.max(0, Math.min(1, m.confidence));
            const heatColor = confidenceColor(conf);
            const opacity = m.isPrimary ? 1 : Math.max(0.6, conf);
            return (
              <div
                key={`mm-${i}`}
                className="absolute pointer-events-none"
                style={{
                  left: Math.floor(xClamped) - tickW / 2,
                  top: 0,
                  bottom: 0,
                  width: tickW,
                  background: heatColor,
                  opacity,
                  boxShadow: m.isPrimary
                    ? `0 0 6px ${heatColor}, 0 0 1px rgba(0,0,0,0.6)`
                    : "0 0 1px rgba(0,0,0,0.5)",
                }}
              >
                {/* Diamond head — same heat color as the body. Active
                 * candidate gets a brighter inner halo. */}
                <span
                  className="absolute pointer-events-none"
                  style={{
                    top: -3,
                    left: tickW / 2 - headSize / 2,
                    width: headSize,
                    height: headSize,
                    background: heatColor,
                    transform: "rotate(45deg)",
                    boxShadow: m.isPrimary
                      ? `0 0 0 1.5px rgba(0,0,0,0.5), 0 0 6px ${heatColor}`
                      : "0 0 0 1px rgba(0,0,0,0.5)",
                  }}
                  title={`Match candidate · ${Math.round(conf * 100)}% confidence${m.isPrimary ? " (active)" : ""}`}
                />
                {showLabel[listIdx] && (
                  <span
                    className="absolute font-mono leading-none pointer-events-none"
                    style={{
                      top: 8,
                      left: tickW / 2 - LABEL_W / 2,
                      width: LABEL_W,
                      fontSize: 8,
                      textAlign: "center",
                      color: "rgba(255,255,255,0.95)",
                      textShadow: "0 1px 1px rgba(0,0,0,0.85)",
                      fontWeight: m.isPrimary ? 700 : 500,
                    }}
                  >
                    {Math.round(conf * 100)}
                  </span>
                )}
              </div>
            );
          });
        })()}

      {/* Brass splice tabs at every cut. Hover lifts the tab + reveals an
        * × button for delete. Pointer-down on the tab body starts a
        * drag — pointermove pulls the cut along with the cursor (snap-
        * aware via the parent's onCutDrag callback). */}
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
            onDragStart={
              onCutDrag ? (e) => beginCutDrag(cut, e) : undefined
            }
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
  onDragStart,
}: {
  x: number;
  height: number;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
  onDelete: (e: MouseEvent<HTMLButtonElement>) => void;
  /** Pointer-down on the tab body starts a drag. The parent wires this
   *  up to its own drag-state machinery (window-level pointermove/up). */
  onDragStart?: (e: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onDragStart) return;
    // Don't start a drag if the user grabbed the × button.
    const target = e.target as HTMLElement | null;
    if (target?.closest("button")) return;
    onDragStart(e);
  };
  return (
    <div
      // Hit area is wider than the visible tab so it's tappable even on touch.
      className="absolute top-[-2px]"
      style={{
        left: x - 8,
        width: 16,
        height: height + 4,
        cursor: onDragStart ? "ew-resize" : "pointer",
        touchAction: "none",
      }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      onPointerDown={onPointerDown}
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

/** Map a 0..1 confidence value to a heatmap color.
 *  Non-linear hue mapping (≈ pow 2.2) compresses the low end and
 *  expands the high end, so 80 % vs 100 % are clearly different greens
 *  instead of two shades of the same green. Saturation + lightness
 *  also climb with confidence, so high-quality matches *glow* more
 *  than weak ones. */
function confidenceColor(c: number): string {
  const v = Math.max(0, Math.min(1, c));
  // Stretch the high end of the hue ramp:
  //   v=1.00 → hue 135 (full green)
  //   v=0.90 → hue ≈ 105 (green-cyan)
  //   v=0.80 → hue ≈  82 (yellow-green)
  //   v=0.70 → hue ≈  62 (yellow)
  //   v=0.50 → hue ≈  29 (orange)
  //   v=0.30 → hue ≈  10 (red-orange)
  //   v=0.00 → hue   0 (red)
  const hue = Math.pow(v, 2.2) * 135;
  const sat = 70 + 25 * v; // 70 % → 95 %
  const light = 38 + 18 * v; // 38 % → 56 %
  return `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%)`;
}
