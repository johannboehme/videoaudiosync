/**
 * FX-Capsule-Layer für die ProgramStrip — fresh-take redesign.
 *
 * Konzept (anders als die Sub-Row-Lösung von davor):
 *   - **Eine** Lane für alle FX, jede Capsule nutzt die volle Höhe der
 *     FX-Hälfte. Kein Jumping zwischen Sub-Rows beim Drag.
 *   - Überlappende Capsules werden via z-Order gestapelt (spätere im
 *     Store rendern oben drauf), mit ~85 % Opacity, sodass darunter
 *     liegende noch sichtbar sind. Stack-Tiefe ist visuell durch die
 *     gemischten Farbton-Layer ablesbar.
 *   - Edge-Grips sind IMMER da, auch für Mini-Capsules — die Hit-Area
 *     ragt nach außen über den sichtbaren Capsule-Rand hinaus, sodass
 *     der User auch eine 14 px breite Capsule am Rand greifen kann.
 *   - Lösch-Affordance: tap-to-select. Selected-Capsule kriegt einen
 *     hellen Outline + ein persistentes × als Sibling der Capsules
 *     (nicht als Child, damit hover-leave-Race entfällt). × bleibt
 *     sichtbar bis Click-Outside / anderer Tap / Delete-Key / Esc.
 */
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import type { PunchFx } from "../../fx/types";
import { fxCatalog } from "../../fx/catalog";

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

const MIN_VISIBLE_W = 14;
/** Edge-Drag-Hit ragt nach außen UND ein wenig nach innen. Mini-Capsules
 *  bekommen so trotzdem eine greifbare Edge. */
const EDGE_HIT_OUTER_PX = 10;
const EDGE_HIT_INNER_PX = 4;
const EDGE_VISUAL_PX = 4;
const X_BUTTON_SIZE = 20;
const X_BUTTON_GAP = 4;
const TAP_THRESHOLD_PX = 5;

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
  /** Sticky selection — set by tap, cleared by click-outside, Esc, or
   *  Delete-key. Drives the visible × affordance and (later) keyboard
   *  delete shortcut. */
  const [selectedFxId, setSelectedFxId] = useState<string | null>(null);

  // Click outside the layer → clear selection. The × button is a child
  // of the layer (rendered as a sibling of the capsules), so clicks on
  // it correctly count as "inside" and don't dismiss.
  useEffect(() => {
    if (!selectedFxId) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node | null;
      if (t && containerRef.current?.contains(t)) return;
      setSelectedFxId(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setSelectedFxId(null);
      } else if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedFxId &&
        onRemoveFx
      ) {
        // Don't fire when typing in inputs.
        const ae = document.activeElement as HTMLElement | null;
        const tag = ae?.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || ae?.isContentEditable) return;
        e.preventDefault();
        onRemoveFx(selectedFxId);
        setSelectedFxId(null);
      }
    };
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [selectedFxId, onRemoveFx]);

  // If the selected fx is removed externally, drop the selection.
  useEffect(() => {
    if (!selectedFxId) return;
    if (!fx.some((f) => f.id === selectedFxId)) setSelectedFxId(null);
  }, [fx, selectedFxId]);

  const visibleSpan = Math.max(1e-6, viewEndS - viewStartS);
  const tToX = (t: number) => ((t - viewStartS) / visibleSpan) * width;
  const xToT = (x: number) => viewStartS + (x / width) * visibleSpan;

  /** Resolve visual rect for a fx — clamps to MIN_VISIBLE_W centered
   *  on the natural midpoint when actual extent is smaller. */
  const visualRect = (f: PunchFx) => {
    const naturalLeft = tToX(f.inS);
    const naturalRight = tToX(f.outS);
    const naturalW = naturalRight - naturalLeft;
    if (naturalW >= MIN_VISIBLE_W) {
      return { left: naturalLeft, width: naturalW };
    }
    const center = (naturalLeft + naturalRight) / 2;
    return { left: center - MIN_VISIBLE_W / 2, width: MIN_VISIBLE_W };
  };

  const beginEdgeDrag = (
    f: PunchFx,
    edge: "in" | "out",
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    const cb = edge === "in" ? onFxIn : onFxOut;
    if (!cb || !containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    setSelectedFxId(f.id);
    const onMove = (ev: PointerEvent) => {
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const newPointerX = ev.clientX - r.left;
      cb(f.id, xToT(Math.max(0, Math.min(width, newPointerX))), {
        shiftKey: ev.shiftKey,
      });
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

  /** Body pointerdown — selects immediately, promotes to drag-move when
   *  pointer travels past TAP_THRESHOLD_PX. Pure tap leaves the capsule
   *  selected (visible × affordance). */
  const beginBodyPointer = (
    f: PunchFx,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!containerRef.current) return;
    e.stopPropagation();
    setSelectedFxId(f.id);

    if (!onFxMove) return;
    const startX = e.clientX;
    const startY = e.clientY;
    const containerRect = containerRef.current.getBoundingClientRect();
    const grabT = xToT(e.clientX - containerRect.left);
    const grabOffsetT = grabT - f.inS;
    let dragging = false;

    const onMove = (ev: PointerEvent) => {
      if (!dragging) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (Math.hypot(dx, dy) < TAP_THRESHOLD_PX) return;
        dragging = true;
      }
      if (!containerRef.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const newPointerT = xToT(ev.clientX - r.left);
      onFxMove(f.id, newPointerT - grabOffsetT, { shiftKey: ev.shiftKey });
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

  const selectedFx = selectedFxId
    ? fx.find((f) => f.id === selectedFxId) ?? null
    : null;

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ width, height, overflow: "visible" }}
    >
      {fx.map((f, idx) => {
        const { left: visualLeft, width: visualWidth } = visualRect(f);
        if (visualLeft + visualWidth < -8 || visualLeft > width + 8) return null;
        const isLive = liveFxIds.has(f.id);
        const isSelected = selectedFxId === f.id;
        const def = fxCatalog[f.kind];
        const showLabel = visualWidth > 32 && height >= 14;

        return (
          <div
            key={f.id}
            className="absolute"
            style={{
              left: visualLeft,
              top: 0,
              width: visualWidth,
              height,
              // Later in array → renders on top so the user sees their
              // most recent FX clearly.
              zIndex: 10 + idx,
            }}
            data-fx-id={f.id}
          >
            {/* Capsule body — handles tap-select + body drag-move. */}
            <div
              className="absolute inset-0 rounded-[3px]"
              style={capsuleBodyStyle(def.capsuleColor, isLive, isSelected)}
              onPointerDown={(e) => {
                const target = e.target as HTMLElement;
                if (target.closest("[data-fx-edge]")) return;
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
                    fontSize: Math.min(9, Math.max(7, height - 6)),
                    color: "rgba(255,255,255,0.92)",
                    textShadow: "0 1px 0 rgba(0,0,0,0.55)",
                  }}
                >
                  {def.label}
                </span>
              )}
            </div>

            {/* Left grippy edge — extends OUTSIDE the visible capsule for
             *  generous hit-area, even on tiny capsules. Higher z than
             *  the body so the edge wins pointer events at the corners. */}
            <div
              data-fx-edge="in"
              onPointerDown={(e) => beginEdgeDrag(f, "in", e)}
              className="absolute"
              style={{
                left: -EDGE_HIT_OUTER_PX,
                top: 0,
                width: EDGE_HIT_OUTER_PX + EDGE_HIT_INNER_PX,
                height,
                cursor: "ew-resize",
                touchAction: "none",
                zIndex: 5,
              }}
              aria-label="Drag fx in"
            >
              <span
                aria-hidden
                className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                style={{
                  left: EDGE_HIT_OUTER_PX - EDGE_VISUAL_PX / 2,
                  width: EDGE_VISUAL_PX,
                  height: Math.min(height - 4, 14),
                  background:
                    "repeating-linear-gradient(90deg, rgba(0,0,0,0.65) 0 1px, rgba(255,255,255,0.85) 1px 2px)",
                  borderRadius: 1,
                }}
              />
            </div>

            {/* Right grippy edge — drag-out. Always visible. */}
            <div
              data-fx-edge="out"
              onPointerDown={(e) => beginEdgeDrag(f, "out", e)}
              className="absolute"
              style={{
                right: -EDGE_HIT_OUTER_PX,
                top: 0,
                width: EDGE_HIT_OUTER_PX + EDGE_HIT_INNER_PX,
                height,
                cursor: "ew-resize",
                touchAction: "none",
                zIndex: 5,
              }}
              aria-label="Drag fx out"
            >
              <span
                aria-hidden
                className="absolute top-1/2 -translate-y-1/2 pointer-events-none"
                style={{
                  right: EDGE_HIT_OUTER_PX - EDGE_VISUAL_PX / 2,
                  width: EDGE_VISUAL_PX,
                  height: Math.min(height - 4, 14),
                  background:
                    "repeating-linear-gradient(90deg, rgba(0,0,0,0.65) 0 1px, rgba(255,255,255,0.85) 1px 2px)",
                  borderRadius: 1,
                }}
              />
            </div>
          </div>
        );
      })}

      {/* Persistent delete button for the currently-selected fx. Rendered
       *  as a sibling of the capsules (not a child) so hover-leave races
       *  can't dismiss it — only an explicit click-outside or another
       *  selection clears it. */}
      {selectedFx && onRemoveFx && (
        <DeleteButton
          fx={selectedFx}
          visualRect={visualRect(selectedFx)}
          stripWidth={width}
          stripHeight={height}
          xDirection={xDirection}
          onRemove={() => {
            onRemoveFx(selectedFx.id);
            setSelectedFxId(null);
          }}
        />
      )}
    </div>
  );
}

function DeleteButton({
  visualRect: rect,
  stripWidth,
  stripHeight,
  xDirection,
  onRemove,
}: {
  fx: PunchFx;
  visualRect: { left: number; width: number };
  stripWidth: number;
  stripHeight: number;
  xDirection: "up" | "down";
  onRemove: () => void;
}) {
  // Centre the X above/below the capsule visual midpoint.
  const cx = rect.left + rect.width / 2;
  const xLeft = Math.max(2, Math.min(stripWidth - X_BUTTON_SIZE - 2, cx - X_BUTTON_SIZE / 2));
  const top =
    xDirection === "down"
      ? stripHeight + X_BUTTON_GAP
      : -X_BUTTON_GAP - X_BUTTON_SIZE;
  return (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        onRemove();
      }}
      aria-label="Remove fx"
      title="Remove fx (Delete)"
      className="absolute z-50 flex items-center justify-center rounded-full bg-paper-hi border border-rule shadow-md text-ink-2 hover:text-danger hover:border-danger font-mono leading-none"
      style={{
        left: xLeft,
        top,
        width: X_BUTTON_SIZE,
        height: X_BUTTON_SIZE,
        fontSize: 13,
      }}
    >
      ×
    </button>
  );
}

function capsuleBodyStyle(
  color: string,
  isLive: boolean,
  isSelected: boolean,
): CSSProperties {
  const stroke = darken(color, 0.6);
  return {
    background: `linear-gradient(180deg, ${lighten(color, 0.18)} 0%, ${color} 45%, ${darken(color, 0.32)} 100%)`,
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,0.45)",
      "inset 0 -1px 0 rgba(0,0,0,0.45)",
      isLive
        ? `0 0 4px ${color}, 0 0 8px rgba(255,255,255,0.45)`
        : "0 1px 1px rgba(0,0,0,0.35)",
      isSelected
        ? "0 0 0 2px rgba(255,255,255,0.85), 0 0 6px rgba(255,255,255,0.4)"
        : "",
    ]
      .filter(Boolean)
      .join(", "),
    border: `1px solid ${stroke}`,
    // 0.85 opacity so overlapping capsules show through.
    opacity: 0.88,
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
