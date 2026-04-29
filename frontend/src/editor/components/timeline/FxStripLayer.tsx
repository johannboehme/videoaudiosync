/**
 * FX-Capsule-Layer für die ProgramStrip.
 *
 * Greedy-packed FX-Capsules in Sub-Slots (Stack-Tiefe = max gleichzeitige
 * Überlappung). FX überlappen frei und stapeln sich — anders als Cuts
 * (exklusiv schaltend), Stacking ist hier ein Feature, nicht ein Bug.
 *
 * Bedienung:
 *   - Pointerdown auf Body → wenn pointer < 5 px in 250 ms zurücklegt =
 *     Tap → toggle Delete-X-Sichtbarkeit. Sonst → drag-move (verschiebt
 *     in/out gemeinsam, snapt auf inS).
 *   - Pointerdown auf left/right grippy edge → drag-in/out (snap-aware).
 *   - Tap auf Delete-X → onRemoveFx.
 *   - Hover (mouse only) → revealed temporär (click outside löscht).
 *
 * Visual-Mindestbreite: 14 px für sehr kurze Capsules (Tap-default-length
 * bei stark herausgezoomter Timeline ergibt 1-2 px breite Capsules — die
 * sind unbedienbar). Die Drag-Edges greifen auf die *visuelle* Position;
 * der User editiert direkt den Time-Range darunter.
 */
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { PunchFx } from "../../fx/types";
import { fxCatalog } from "../../fx/catalog";
import { packFxIntoSlots } from "../../fx/pack";

interface Props {
  fx: readonly PunchFx[];
  viewStartS: number;
  viewEndS: number;
  width: number;
  height: number;
  /** Where the delete-X pops out — up (cuts side) or down (fx side). */
  xDirection: "up" | "down";
  liveFxIds: ReadonlySet<string>;
  onFxIn?: (id: string, rawT: number, e: { shiftKey: boolean }) => number;
  onFxOut?: (id: string, rawT: number, e: { shiftKey: boolean }) => number;
  onFxMove?: (id: string, rawT: number, e: { shiftKey: boolean }) => number;
  onRemoveFx?: (id: string) => void;
}

const HANDLE_HIT_PX = 22;
const HANDLE_VISIBLE_PX = 5;
const MIN_VISIBLE_W = 14;
const MIN_SLOT_H = 10;
const X_BUTTON_SIZE = 18;
const X_BUTTON_GAP = 4;
const TAP_THRESHOLD_PX = 5;
const TAP_THRESHOLD_MS = 260;

export function FxStripLayer({
  fx,
  viewStartS,
  viewEndS,
  width,
  height,
  xDirection,
  liveFxIds,
  onFxIn,
  onFxOut,
  onFxMove,
  onRemoveFx,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  /** Which fx is showing its delete-X. Set by tap, hover (mouse), or
   *  external "currently dragging" hint. Cleared by click outside or
   *  Escape. */
  const [revealedFxId, setRevealedFxId] = useState<string | null>(null);

  // Click-outside dismissal: any pointerdown that lands outside this
  // layer clears the reveal. Without this the X would persist forever
  // after a tap.
  useEffect(() => {
    if (!revealedFxId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && containerRef.current?.contains(t)) return;
      setRevealedFxId(null);
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, [revealedFxId]);

  const layout = useMemo(() => packFxIntoSlots(fx), [fx]);
  const slotById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of layout.layout) m.set(l.id, l.slotIdx);
    return m;
  }, [layout]);

  const visibleSpan = Math.max(1e-6, viewEndS - viewStartS);
  // Cap visible sub-rows so very deep stacks don't shrink each capsule
  // into invisibility. Excess rows wrap around to the last visible slot
  // with a slight z-offset (handled by CSS box-shadow on the body).
  const maxVisibleSlots = Math.max(1, Math.floor(height / MIN_SLOT_H));
  const visibleSlots = Math.min(layout.slots, maxVisibleSlots);
  const slotH = visibleSlots > 0 ? height / visibleSlots : height;

  const tToX = (t: number) => ((t - viewStartS) / visibleSpan) * width;
  const xToT = (x: number) => viewStartS + (x / width) * visibleSpan;

  const beginEdgeDrag = (
    f: PunchFx,
    edge: "in" | "out",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const cb = edge === "in" ? onFxIn : onFxOut;
    if (!cb || !containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const onMove = (ev: PointerEvent) => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const newPointerX = ev.clientX - r.left;
      const newPointerT = xToT(Math.max(0, Math.min(width, newPointerX)));
      cb(f.id, newPointerT, { shiftKey: ev.shiftKey });
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  /**
   * Body pointerdown: distinguishes tap (toggle X-reveal) from drag-move.
   * Tap = pointer moved < TAP_THRESHOLD_PX within TAP_THRESHOLD_MS. Drag
   * promotes immediately when threshold crossed and hands off to onFxMove.
   */
  const beginBodyPointer = (
    f: PunchFx,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!containerRef.current) return;
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    const startTime = performance.now();
    const containerRect = containerRef.current.getBoundingClientRect();
    const grabT = xToT(e.clientX - containerRect.left);
    const grabOffsetT = grabT - f.inS;
    let promotedToDrag = false;

    const onMove = (ev: PointerEvent) => {
      if (promotedToDrag) {
        if (!onFxMove || !containerRef.current) return;
        const r = containerRef.current.getBoundingClientRect();
        const newPointerT = xToT(ev.clientX - r.left);
        onFxMove(f.id, newPointerT - grabOffsetT, { shiftKey: ev.shiftKey });
        return;
      }
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (Math.hypot(dx, dy) >= TAP_THRESHOLD_PX) {
        promotedToDrag = true;
        if (!onFxMove) {
          // No drag callback wired — abort gracefully.
          cleanup();
          return;
        }
      }
    };
    const onUp = (ev: PointerEvent) => {
      cleanup();
      const dt = performance.now() - startTime;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      const moved = Math.hypot(dx, dy) >= TAP_THRESHOLD_PX;
      if (!promotedToDrag && !moved && dt < TAP_THRESHOLD_MS) {
        // Tap — toggle reveal for this capsule.
        setRevealedFxId((prev) => (prev === f.id ? null : f.id));
      }
    };
    function cleanup() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ width, height, overflow: "visible" }}
    >
      {fx.map((f) => {
        const slotIdx = slotById.get(f.id) ?? 0;
        const naturalLeft = tToX(f.inS);
        const naturalRight = tToX(f.outS);
        // Visual layout: enforce a minimum width so very short taps stay
        // grabbable at any zoom. The visual range may extend past the
        // actual time range — drag-edges still map back to inS/outS via
        // the natural anchor, so editing remains accurate.
        const naturalWidth = naturalRight - naturalLeft;
        let visualLeft = naturalLeft;
        let visualWidth = naturalWidth;
        if (naturalWidth < MIN_VISIBLE_W) {
          const center = (naturalLeft + naturalRight) / 2;
          visualLeft = center - MIN_VISIBLE_W / 2;
          visualWidth = MIN_VISIBLE_W;
        }
        if (visualLeft + visualWidth < -8 || visualLeft > width + 8) return null;
        // Stacks past visibleSlots wrap onto the last slot with a darker
        // overlay so the user sees "more underneath".
        const visibleSlotIdx = Math.min(slotIdx, visibleSlots - 1);
        const isOverflowSlot = slotIdx >= visibleSlots;
        const top = visibleSlotIdx * slotH;
        const isLive = liveFxIds.has(f.id);
        const isRevealed = revealedFxId === f.id;
        const def = fxCatalog[f.kind];

        // Wrapper extends BEYOND the visible capsule to include the X-
        // button hover area, so moving from capsule to X doesn't leave
        // the hover region.
        const wrapperHeight = slotH + X_BUTTON_GAP + X_BUTTON_SIZE;
        const wrapperTop = xDirection === "up" ? top - X_BUTTON_GAP - X_BUTTON_SIZE : top;
        const capsuleY = xDirection === "up" ? X_BUTTON_GAP + X_BUTTON_SIZE : 0;
        // Capsules can be very narrow — only show the etched label when
        // there's room. Edge-grip is suppressed for capsules too narrow
        // to even show body grip — falls back to body-drag only.
        const showLabel = visualWidth > 30 && slotH >= 12;
        const showEdgeGrips = visualWidth >= 22 && slotH >= 8;

        return (
          <div
            key={f.id}
            className="absolute"
            style={{
              left: visualLeft,
              top: wrapperTop,
              width: visualWidth,
              height: wrapperHeight,
            }}
            onPointerEnter={(e) => {
              if (e.pointerType === "mouse") setRevealedFxId(f.id);
            }}
            onPointerLeave={(e) => {
              // Only auto-hide for mouse — touch-revealed entries stick
              // until tap-outside (handled in the document-level effect).
              if (e.pointerType === "mouse") {
                // Don't auto-hide if a tap revealed and pointer just hovered
                // away — let the click-outside listener take care of that.
                setRevealedFxId((prev) => (prev === f.id ? null : prev));
              }
            }}
            data-fx-id={f.id}
          >
            {/* Capsule body */}
            <div
              aria-hidden
              className="absolute rounded-[4px] overflow-hidden"
              style={{
                left: 0,
                top: capsuleY,
                width: visualWidth,
                height: Math.max(MIN_SLOT_H - 1, slotH - 1),
                ...capsuleBodyStyle(def.capsuleColor, isLive, isOverflowSlot),
              }}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest("[data-fx-edge]")) return;
                if (target.closest("[data-fx-x]")) return;
                beginBodyPointer(f, e);
              }}
            >
              {/* Live-recording leading-edge pulse — subtle, no big REC label. */}
              {isLive && (
                <span
                  className="absolute right-0 top-0 bottom-0 pointer-events-none"
                  style={{
                    width: 3,
                    background:
                      "linear-gradient(180deg, #FFFFFF 0%, rgba(255,255,255,0.7) 100%)",
                    boxShadow: `0 0 6px ${def.capsuleColor}, 0 0 12px rgba(255,255,255,0.8)`,
                    animation: "vas-fx-live-pulse 0.7s ease-in-out infinite",
                  }}
                />
              )}
              {showLabel && (
                <span
                  className="absolute inset-0 flex items-center justify-center font-display uppercase tracking-label pointer-events-none"
                  style={{
                    fontSize: Math.min(9, Math.max(7, slotH - 4)),
                    color: "rgba(255,255,255,0.92)",
                    textShadow: "0 1px 0 rgba(0,0,0,0.55)",
                  }}
                >
                  {def.label}
                </span>
              )}
            </div>

            {/* Left grippy edge — drag-in. Suppressed for sub-min capsules. */}
            {showEdgeGrips && (
              <div
                data-fx-edge="in"
                onPointerDown={(e) => beginEdgeDrag(f, "in", e)}
                className="absolute"
                style={{
                  left: -HANDLE_HIT_PX / 2 + HANDLE_VISIBLE_PX / 2,
                  top: capsuleY,
                  width: HANDLE_HIT_PX,
                  height: slotH,
                  cursor: "ew-resize",
                  touchAction: "none",
                }}
                aria-label="Drag fx in"
              >
                <span
                  aria-hidden
                  className="absolute top-1/2 -translate-y-1/2"
                  style={{
                    left: HANDLE_HIT_PX / 2 - HANDLE_VISIBLE_PX / 2,
                    width: HANDLE_VISIBLE_PX,
                    height: Math.min(slotH - 4, 14),
                    background:
                      "repeating-linear-gradient(90deg, rgba(0,0,0,0.55) 0 1px, rgba(255,255,255,0.7) 1px 2px)",
                    borderRadius: 1,
                  }}
                />
              </div>
            )}

            {/* Right grippy edge — drag-out. */}
            {showEdgeGrips && (
              <div
                data-fx-edge="out"
                onPointerDown={(e) => beginEdgeDrag(f, "out", e)}
                className="absolute"
                style={{
                  right: -HANDLE_HIT_PX / 2 + HANDLE_VISIBLE_PX / 2,
                  top: capsuleY,
                  width: HANDLE_HIT_PX,
                  height: slotH,
                  cursor: "ew-resize",
                  touchAction: "none",
                }}
                aria-label="Drag fx out"
              >
                <span
                  aria-hidden
                  className="absolute top-1/2 -translate-y-1/2"
                  style={{
                    right: HANDLE_HIT_PX / 2 - HANDLE_VISIBLE_PX / 2,
                    width: HANDLE_VISIBLE_PX,
                    height: Math.min(slotH - 4, 14),
                    background:
                      "repeating-linear-gradient(90deg, rgba(0,0,0,0.55) 0 1px, rgba(255,255,255,0.7) 1px 2px)",
                    borderRadius: 1,
                  }}
                />
              </div>
            )}

            {/* Delete-X — popping in xDirection. Inside the wrapper so
             *  hover doesn't leak when moving toward it. */}
            {isRevealed && onRemoveFx && (
              <button
                data-fx-x
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveFx(f.id);
                  setRevealedFxId(null);
                }}
                aria-label="Remove fx"
                className="absolute z-10 flex items-center justify-center rounded-full bg-paper-hi border border-rule shadow-md text-ink-2 hover:text-danger hover:border-danger font-mono leading-none"
                style={{
                  left: Math.max(0, visualWidth / 2 - X_BUTTON_SIZE / 2),
                  width: X_BUTTON_SIZE,
                  height: X_BUTTON_SIZE,
                  fontSize: 12,
                  ...(xDirection === "down"
                    ? { top: capsuleY + slotH + X_BUTTON_GAP }
                    : { top: 0 }),
                }}
              >
                ×
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function capsuleBodyStyle(
  color: string,
  isLive: boolean,
  isOverflowSlot: boolean,
): CSSProperties {
  const stroke = darken(color, 0.55);
  const dim = isOverflowSlot ? 0.7 : 1;
  return {
    background: `linear-gradient(180deg, ${lighten(color, 0.18)} 0%, ${color} 45%, ${darken(color, 0.32)} 100%)`,
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,0.45)",
      "inset 0 -1px 0 rgba(0,0,0,0.45)",
      isLive
        ? `0 0 4px ${color}, 0 0 8px rgba(255,255,255,0.45)`
        : isOverflowSlot
          ? "0 1px 0 rgba(0,0,0,0.5), 0 0 0 1px rgba(0,0,0,0.35)"
          : "0 1px 1px rgba(0,0,0,0.35)",
    ].join(", "),
    border: `1px solid ${stroke}`,
    opacity: dim,
  };
}

function lighten(hex: string, fraction: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.min(255, Math.round(parseInt(c.slice(0, 2), 16) + 255 * fraction));
  const g = Math.min(255, Math.round(parseInt(c.slice(2, 4), 16) + 255 * fraction));
  const b = Math.min(255, Math.round(parseInt(c.slice(4, 6), 16) + 255 * fraction));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
function darken(hex: string, fraction: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.max(0, Math.round(parseInt(c.slice(0, 2), 16) * (1 - fraction)));
  const g = Math.max(0, Math.round(parseInt(c.slice(2, 4), 16) * (1 - fraction)));
  const b = Math.max(0, Math.round(parseInt(c.slice(4, 6), 16) * (1 - fraction)));
  return `#${[r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}
