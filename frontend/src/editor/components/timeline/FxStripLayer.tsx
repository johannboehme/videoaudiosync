/**
 * FX-Capsule-Layer für die ProgramStrip.
 *
 * Greedy-packed FX-Capsules in Sub-Slots. Im "fx"-Modus füllt der Layer
 * die volle Strip-Höhe; im "both"-Modus nur die untere Hälfte. Cuts und
 * FX teilen sich den ProgramStrip-Container, aber rendern in eigenständige
 * vertikale Hälften — Delete-X poppt Cuts nach oben, FX nach unten, sodass
 * sich die zwei Aktionen nicht überlappen.
 *
 * Interaktion (analog zu Cuts, aber ohne Paint-Overwrite — FX überlappen frei):
 *   - Pointerdown auf Body → drag-move (verschiebt in/out gemeinsam, snapt
 *     auf den In-Punkt).
 *   - Pointerdown auf left/right "grippy edge" → drag-in/out (snap-aware via
 *     parent-callback).
 *   - Tap auf Body (touch) → blendet das Delete-X ein/aus.
 *   - Tap auf Delete-X → onRemoveFx.
 */
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
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
  /** Total width in CSS pixels — same as the parent strip. */
  width: number;
  /** Height the layer can use, in CSS pixels. */
  height: number;
  /** Where the delete-X pops out — up (cuts side) or down (fx side). */
  xDirection: "up" | "down";
  /** Set of fx ids that are currently being live-extended via a hold.
   *  Drives the live-recording pulse on the leading edge. */
  liveFxIds: ReadonlySet<string>;
  /** Live drag callback for the in-edge. Returns the time it actually
   *  committed to (snapped). */
  onFxIn?: (id: string, rawT: number, e: { shiftKey: boolean }) => number;
  onFxOut?: (id: string, rawT: number, e: { shiftKey: boolean }) => number;
  onFxMove?: (id: string, rawT: number, e: { shiftKey: boolean }) => number;
  onRemoveFx?: (id: string) => void;
}

const HANDLE_HIT_PX = 24; // touch-friendly grippy-edge width
const HANDLE_VISIBLE_PX = 6;
const MIN_CAPSULE_HEIGHT = 4;

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
  /** Which fx is showing its delete-X. Hover (desktop) sets this on enter
   *  and clears on leave; touch toggles on tap. */
  const [revealedFxId, setRevealedFxId] = useState<string | null>(null);

  const layout = useMemo(() => packFxIntoSlots(fx), [fx]);
  const slotById = useMemo(() => {
    const m = new Map<string, number>();
    for (const l of layout.layout) m.set(l.id, l.slotIdx);
    return m;
  }, [layout]);

  const visibleSpan = Math.max(1e-6, viewEndS - viewStartS);
  const slotH =
    layout.slots > 0 ? Math.max(MIN_CAPSULE_HEIGHT, height / layout.slots) : 0;

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
    const rect = containerRef.current.getBoundingClientRect();
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
    void rect;
  };

  const beginBodyDrag = (
    f: PunchFx,
    e: ReactPointerEvent<HTMLDivElement>,
  ) => {
    if (!onFxMove || !containerRef.current) return;
    e.stopPropagation();
    e.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const pointerT = xToT(e.clientX - rect.left);
    const grabOffsetT = pointerT - f.inS;
    const onMove = (ev: PointerEvent) => {
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

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ width, height }}
      onPointerLeave={() => setRevealedFxId(null)}
    >
      {fx.map((f) => {
        const slotIdx = slotById.get(f.id) ?? 0;
        const x1 = tToX(f.inS);
        const x2 = tToX(f.outS);
        if (x2 < -8 || x1 > width + 8) return null;
        const left = Math.max(-2, x1);
        const right = Math.min(width + 2, x2);
        const w = Math.max(2, right - left);
        const top = slotIdx * slotH;
        const isLive = liveFxIds.has(f.id);
        const isRevealed = revealedFxId === f.id;
        const def = fxCatalog[f.kind];

        return (
          <div
            key={f.id}
            className="absolute"
            style={{
              left,
              top,
              width: w,
              height: Math.max(MIN_CAPSULE_HEIGHT - 1, slotH - 1),
            }}
            onPointerEnter={() => setRevealedFxId(f.id)}
            onPointerLeave={() => setRevealedFxId(null)}
            onPointerDown={(e) => {
              // Toggle visibility on touch (no hover); desktop hover is
              // handled via enter/leave. Body-tap also begins a move drag,
              // so we only toggle on touch where hover isn't a thing.
              if ((e.nativeEvent as PointerEvent).pointerType === "touch") {
                setRevealedFxId(isRevealed ? null : f.id);
              }
              // Don't drag if the user grabbed an edge — those listeners
              // call stopPropagation themselves.
              const target = e.target as HTMLElement;
              if (target.closest("[data-fx-edge]")) return;
              if (target.closest("[data-fx-x]")) return;
              beginBodyDrag(f, e);
            }}
            data-fx-id={f.id}
          >
            {/* Capsule body */}
            <div
              aria-hidden
              className="absolute inset-0 rounded-full overflow-hidden"
              style={capsuleStyle(def.capsuleColor, isLive)}
            >
              {/* Live-recording leading-edge pulse — subtle, no big REC label. */}
              {isLive && (
                <span
                  className="absolute right-0 top-0 bottom-0"
                  style={{
                    width: 3,
                    background: "linear-gradient(180deg, #FFFFFF 0%, rgba(255,255,255,0.7) 100%)",
                    boxShadow: `0 0 6px ${def.capsuleColor}, 0 0 12px rgba(255,255,255,0.8)`,
                    animation: "vas-fx-live-pulse 0.7s ease-in-out infinite",
                  }}
                />
              )}
              {/* Etched label — only when capsule is wide enough. */}
              {w > 32 && slotH >= 12 && (
                <span
                  className="absolute inset-0 flex items-center justify-center font-display uppercase tracking-label"
                  style={{
                    fontSize: Math.min(9, Math.max(7, slotH - 4)),
                    color: "rgba(255,255,255,0.85)",
                    textShadow: "0 1px 0 rgba(0,0,0,0.45)",
                    pointerEvents: "none",
                  }}
                >
                  {def.label}
                </span>
              )}
            </div>

            {/* Left grippy edge — drag-in. */}
            <div
              data-fx-edge="in"
              onPointerDown={(e) => beginEdgeDrag(f, "in", e)}
              className="absolute top-0 bottom-0"
              style={{
                left: -HANDLE_HIT_PX / 2 + HANDLE_VISIBLE_PX / 2,
                width: HANDLE_HIT_PX,
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
                  height: Math.min(slotH - 2, 12),
                  background:
                    "repeating-linear-gradient(90deg, rgba(0,0,0,0.4) 0 1px, rgba(255,255,255,0.6) 1px 2px)",
                  borderRadius: 1,
                }}
              />
            </div>

            {/* Right grippy edge — drag-out. */}
            <div
              data-fx-edge="out"
              onPointerDown={(e) => beginEdgeDrag(f, "out", e)}
              className="absolute top-0 bottom-0"
              style={{
                right: -HANDLE_HIT_PX / 2 + HANDLE_VISIBLE_PX / 2,
                width: HANDLE_HIT_PX,
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
                  height: Math.min(slotH - 2, 12),
                  background:
                    "repeating-linear-gradient(90deg, rgba(0,0,0,0.4) 0 1px, rgba(255,255,255,0.6) 1px 2px)",
                  borderRadius: 1,
                }}
              />
            </div>

            {/* Delete-X — popping in xDirection (down for fx, up for cuts).
                We reuse THIS file's component for fx only, so direction is
                practically always "down" — but the prop keeps it
                symmetric for the (rare) future use case. */}
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
                className="absolute z-10 flex items-center justify-center rounded-full bg-paper-hi border border-rule shadow text-ink-2 hover:text-danger hover:border-danger font-mono leading-none"
                style={{
                  left: Math.max(0, w / 2 - 8),
                  width: 16,
                  height: 16,
                  fontSize: 11,
                  ...(xDirection === "down"
                    ? { top: slotH + 4 }
                    : { bottom: slotH + 4 }),
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

function capsuleStyle(color: string, isLive: boolean): CSSProperties {
  return {
    background: `linear-gradient(180deg, ${lighten(color, 0.15)} 0%, ${color} 50%, ${darken(color, 0.25)} 100%)`,
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,0.35)",
      "inset 0 -1px 0 rgba(0,0,0,0.35)",
      isLive
        ? `0 0 4px ${color}, 0 0 8px rgba(255,255,255,0.45)`
        : "0 1px 1px rgba(0,0,0,0.25)",
    ].join(", "),
    border: `1px solid ${darken(color, 0.45)}`,
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
