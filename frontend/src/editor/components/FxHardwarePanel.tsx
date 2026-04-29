/**
 * FX-Hardware-Panel — TE-inspirierter, skeuomorpher Pad-Streifen für die
 * Live-Performance der Punch-In-FX.
 *
 * Optik: Innenraum eines geöffneten Kassettenrekorders / 4-Track-Mechanik.
 * Brushed-aluminium-Body, sichtbare Phillips-Schrauben in den Ecken,
 * recessed Rubber-Pads mit LED-Ring. Sehr bewusst: keine verschachtelten
 * Menüs, alle V1-Bedienung sichtbar in einer einzigen Reihe.
 *
 * Trigger-Modell (spiegelt das TAKE-Hold der Cuts, ABER ohne Paint-
 * Promotion und ohne Overwrite): pointerdown ruft `beginFxHold`,
 * `pointerup`/`pointercancel` rufen `endFxHold`. Der RAF-Tick im Editor
 * erweitert den outS live, solange der Pad gedrückt ist. Esc cancelt.
 *
 * Mobile vs Desktop: Desktop default-eingefahren mit Tab-Edge, Mobile
 * always-open. Steuerung über `ui.fxPanelOpen` und `setFxPanelOpen`.
 */
import { CSSProperties, PointerEvent as ReactPointerEvent, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useEditorStore } from "../store";
import { fxCatalog, defaultTapLengthS } from "../fx/catalog";
import type { FxKind } from "../fx/types";

interface PadDef {
  slotKey: string;
  kind: FxKind;
}

/** V1: ein Pad — Vignette. Spätere Pads werden hier ergänzt. */
const PADS: readonly PadDef[] = [{ slotKey: "pad:0", kind: "vignette" }];

const COLLAPSED_TAB_H = 18; // px — schmaler Edge-Tab im eingefahrenen Zustand
const EXPANDED_H = 96;      // px — ausgefahrene Höhe (desktop)

export function FxHardwarePanel() {
  const fxPanelOpen = useEditorStore((s) => s.ui.fxPanelOpen);
  const setFxPanelOpen = useEditorStore((s) => s.setFxPanelOpen);
  const isMobile = useIsCoarsePointer();

  const open = isMobile || fxPanelOpen;

  return (
    <div
      className="relative w-full select-none"
      style={{
        height: open ? EXPANDED_H : COLLAPSED_TAB_H,
        transition: "height 200ms ease-out",
      }}
    >
      {open ? (
        <ExpandedPanel
          showCollapse={!isMobile}
          onCollapse={() => setFxPanelOpen(false)}
        />
      ) : (
        <CollapsedTab onClick={() => setFxPanelOpen(true)} />
      )}
    </div>
  );
}

/** Tab-Edge im eingefahrenen Zustand — anodized aluminium, knurled grip. */
function CollapsedTab({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Show FX hardware panel"
      title="FX panel"
      className="absolute inset-0 w-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
      style={ALUMINUM_TAB}
    >
      {/* Knurled grip — repeating stripes read as machined ridges. */}
      <span aria-hidden className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-12 rounded-[1px]" style={KNURLED_GRIP} />
      <span aria-hidden className="absolute right-3 top-1/2 -translate-y-1/2 font-display text-[9px] uppercase tracking-label" style={{ color: "rgba(26,24,22,0.6)", textShadow: "0 0.5px 0 rgba(255,255,255,0.5)" }}>
        FX ▾
      </span>
    </button>
  );
}

/** Ausgefahrenes Panel — Mechanik-Innenraum mit Schrauben, Pads, LCD. */
function ExpandedPanel({
  showCollapse,
  onCollapse,
}: {
  showCollapse: boolean;
  onCollapse: () => void;
}) {
  return (
    <div className="relative w-full h-full overflow-hidden" style={MECHANISM_BODY}>
      {/* Vier Phillips-Schrauben in den Ecken — kleines, machined detail. */}
      <Screw left={6} top={6} />
      <Screw right={6} top={6} />
      <Screw left={6} bottom={6} />
      <Screw right={6} bottom={6} />

      {/* Etched horizontal grain across the body. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={BRUSHED_GRAIN} />

      {/* Pad-Reihe + LCD. */}
      <div className="relative h-full flex items-center gap-3 px-6">
        <Lcd />
        <div className="flex items-center gap-3">
          {PADS.map((p) => (
            <FxPad key={p.slotKey} pad={p} />
          ))}
        </div>
        {showCollapse && (
          <button
            type="button"
            onClick={onCollapse}
            aria-label="Hide FX hardware panel"
            title="Hide panel"
            className="ml-auto flex items-center justify-center h-7 w-9 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
            style={ALUMINUM_TAB}
          >
            <span aria-hidden className="font-display text-[10px] uppercase tracking-label" style={{ color: "rgba(26,24,22,0.6)", textShadow: "0 0.5px 0 rgba(255,255,255,0.5)" }}>
              ▴
            </span>
          </button>
        )}
      </div>
    </div>
  );
}

function FxPad({ pad }: { pad: PadDef }) {
  const def = fxCatalog[pad.kind];
  const heldByThisSlot = useEditorStore((s) => Boolean(s.fxHolds[pad.slotKey]));
  const beginFxHold = useEditorStore((s) => s.beginFxHold);
  const endFxHold = useEditorStore((s) => s.endFxHold);
  /** Decay state for the LED — stays glowing for ~200 ms after release. */
  const [glow, setGlow] = useState(0);
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (heldByThisSlot) {
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
      setGlow(1);
    } else if (glow > 0) {
      releaseTimerRef.current = setTimeout(() => {
        setGlow(0);
        releaseTimerRef.current = null;
      }, 220);
    }
    return () => {
      if (releaseTimerRef.current) {
        clearTimeout(releaseTimerRef.current);
        releaseTimerRef.current = null;
      }
    };
  }, [heldByThisSlot, glow]);

  function handleDown(e: ReactPointerEvent<HTMLButtonElement>) {
    e.preventDefault();
    e.stopPropagation();
    // Setze pointer capture so a finger that drifts off the pad still
    // releases via pointerup/pointercancel on the same target.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture not supported (older browsers) — ok, we still get up/cancel */
    }
    const s = useEditorStore.getState();
    const t = s.snapMasterTime(s.playback.currentTime);
    beginFxHold(pad.slotKey, pad.kind, t);
  }
  function handleUp() {
    endFxHold(pad.slotKey);
  }
  function handleCancel() {
    // Cancel = treat as release (the user lifted, even if browser cancelled
    // mid-gesture). Don't drop the FX — that's what Esc is for. Keeps
    // performance flow when the user accidentally swipes off the pad.
    endFxHold(pad.slotKey);
  }

  return (
    <motion.button
      type="button"
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleCancel}
      onPointerLeave={() => {
        // Only relevant if we *don't* have pointer-capture (rare). With
        // capture set, leave fires after up/cancel anyway — no extra work.
      }}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.05, ease: "easeOut" }}
      aria-label={`Trigger ${def.label}`}
      title={`${def.label} — hold to play`}
      className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
      style={padBodyStyle(heldByThisSlot, def.capsuleColor, glow)}
    >
      {/* Inner rubber face — tactile dome. */}
      <span
        aria-hidden
        className="absolute inset-[3px] rounded-[5px]"
        style={padRubberStyle(heldByThisSlot, def.capsuleColor)}
      />
      <span
        aria-hidden
        className="relative font-display text-[10px] uppercase tracking-label"
        style={{
          color: heldByThisSlot ? "#FFFFFF" : "rgba(255,255,255,0.85)",
          textShadow: heldByThisSlot
            ? `0 0 6px ${def.capsuleColor}, 0 1px 0 rgba(0,0,0,0.4)`
            : "0 1px 0 rgba(0,0,0,0.45)",
        }}
      >
        {def.label}
      </span>
    </motion.button>
  );
}

function Lcd() {
  // Show the kind + default-tap-length of the most-recent or first pad.
  // V1 has only one pad — easy. Later: track lastTriggeredPad in the store.
  const bpm = useEditorStore((s) => s.jobMeta?.bpm?.value ?? null);
  const def = fxCatalog[PADS[0].kind];
  const intensityDefault = def.defaultParams.intensity ?? 0;
  const tapLen = defaultTapLengthS(PADS[0].kind, bpm);
  return (
    <div
      aria-hidden
      className="flex flex-col justify-center px-3 py-1 rounded-sm font-mono leading-tight"
      style={LCD_STYLE}
    >
      <span style={{ fontSize: 9, opacity: 0.7 }}>{def.label}</span>
      <span style={{ fontSize: 11 }}>INT {Math.round(intensityDefault * 100)}</span>
      <span style={{ fontSize: 9, opacity: 0.6 }}>
        {tapLen.toFixed(2)}s tap
      </span>
    </div>
  );
}

function Screw({
  left,
  right,
  top,
  bottom,
}: {
  left?: number;
  right?: number;
  top?: number;
  bottom?: number;
}) {
  return (
    <span
      aria-hidden
      className="absolute"
      style={{
        left,
        right,
        top,
        bottom,
        width: 8,
        height: 8,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 35% 30%, #DCD3BB 0%, #ADA28A 55%, #837A66 100%)",
        boxShadow:
          "inset 0 -1px 0 rgba(0,0,0,0.35), 0 0.5px 0.5px rgba(0,0,0,0.4)",
      }}
    >
      {/* Phillips slot */}
      <span
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(0deg, transparent 44%, rgba(0,0,0,0.55) 44%, rgba(0,0,0,0.55) 56%, transparent 56%), linear-gradient(90deg, transparent 44%, rgba(0,0,0,0.55) 44%, rgba(0,0,0,0.55) 56%, transparent 56%)",
        }}
      />
    </span>
  );
}

function useIsCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(pointer: coarse)").matches;
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mql = window.matchMedia("(pointer: coarse)");
    const onChange = (e: MediaQueryListEvent) => setCoarse(e.matches);
    if (mql.addEventListener) {
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    }
    // Safari < 14 fallback
    const legacy = mql as unknown as { addListener?: (cb: (ev: MediaQueryListEvent) => void) => void; removeListener?: (cb: (ev: MediaQueryListEvent) => void) => void };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);
  return coarse;
}

void AnimatePresence; // reserved for future per-pad LED transitions

const ALUMINUM_TAB: CSSProperties = {
  background:
    "linear-gradient(180deg, #E8E1D0 0%, #D5CAA8 52%, #C9BFA6 100%)",
  border: "1px solid rgba(26,24,22,0.22)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.55)",
    "inset 0 -1px 0 rgba(0,0,0,0.10)",
    "0 1px 1px rgba(0,0,0,0.08)",
  ].join(", "),
  cursor: "pointer",
};

const KNURLED_GRIP: CSSProperties = {
  background:
    "repeating-linear-gradient(90deg, rgba(26,24,22,0.22) 0px, rgba(26,24,22,0.22) 1px, rgba(255,255,255,0.55) 1px, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 3px)",
  boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
};

const MECHANISM_BODY: CSSProperties = {
  background: [
    // dark mounting plate underneath
    "linear-gradient(180deg, #2A2722 0%, #1A1816 100%)",
  ].join(", "),
  borderTop: "1px solid rgba(0,0,0,0.5)",
  borderBottom: "1px solid rgba(0,0,0,0.5)",
  boxShadow:
    "inset 0 1px 1px rgba(255,255,255,0.04), inset 0 -1px 1px rgba(0,0,0,0.4)",
};

const BRUSHED_GRAIN: CSSProperties = {
  background:
    "repeating-linear-gradient(90deg, transparent 0, transparent 1px, rgba(255,255,255,0.025) 1px, rgba(255,255,255,0.025) 2px), linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
};

const LCD_STYLE: CSSProperties = {
  background: "linear-gradient(180deg, #1F2A1E 0%, #243228 100%)",
  color: "#9FE08E",
  textShadow: "0 0 4px rgba(159,224,142,0.55)",
  border: "1px solid rgba(0,0,0,0.6)",
  boxShadow:
    "inset 0 1px 1px rgba(0,0,0,0.7), inset 0 -1px 1px rgba(255,255,255,0.04)",
  width: 88,
  height: 56,
};

function padBodyStyle(
  pressed: boolean,
  ledColor: string,
  glow: number,
): CSSProperties {
  return {
    width: 64,
    height: 56,
    minWidth: 48,
    minHeight: 48,
    background:
      "linear-gradient(180deg, #4A4640 0%, #2C2925 100%)",
    border: "1px solid rgba(0,0,0,0.7)",
    boxShadow: [
      // recessed-into-metal feel
      "inset 0 1px 1px rgba(255,255,255,0.08)",
      "inset 0 -1px 1px rgba(0,0,0,0.6)",
      // LED halo
      glow > 0
        ? `0 0 ${8 * glow}px ${ledColor}, 0 0 ${16 * glow}px ${ledColor}`
        : "0 1px 1px rgba(0,0,0,0.4)",
    ].join(", "),
    transform: pressed ? "translateY(1px)" : "translateY(0)",
    transition: "box-shadow 220ms ease-out, transform 60ms ease-out",
  };
}

function padRubberStyle(pressed: boolean, color: string): CSSProperties {
  return {
    background: pressed
      ? `radial-gradient(circle at 50% 35%, ${lighten(color, 0.25)} 0%, ${color} 40%, ${darken(color, 0.4)} 100%)`
      : `radial-gradient(circle at 50% 35%, ${lighten(color, 0.18)} 0%, ${darken(color, 0.15)} 50%, ${darken(color, 0.5)} 100%)`,
    boxShadow:
      "inset 0 1px 1px rgba(255,255,255,0.18), inset 0 -1px 1px rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
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
