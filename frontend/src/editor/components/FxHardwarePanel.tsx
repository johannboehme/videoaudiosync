/**
 * FX-Hardware-Panel — TE-inspirierter, skeuomorpher Pad-Streifen für die
 * Live-Performance der Punch-In-FX.
 *
 * Optik: Innenraum eines geöffneten Kassettenrekorders. Brushed-aluminium-
 * Body, Phillips-Schrauben, recessed Rubber-Pads mit LED-Ring.
 *
 * Layout:
 *   - Top-Edge-Strip ist immer sichtbar — knurled grip + label + chevron.
 *     Click toggelt collapsed/expanded. Konsistent zwischen den beiden
 *     Zuständen, keine versteckten Affordances.
 *   - Collapsed: nur die Top-Edge ist da (~16 px), Panel darunter null.
 *   - Expanded: Top-Edge oben + Pad-Bereich darunter (~80 px gesamt ~96).
 *
 * Mobile: Top-Edge dient nur als Label, Panel ist immer expanded
 *   (kein keyboard → Pads sind das einzige Trigger-Mittel).
 *
 * Trigger: pointerdown→beginFxHold, pointerup/cancel→endFxHold. RAF
 * tick im Editor zieht outS live an die Playhead-Position.
 */
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { motion } from "framer-motion";
import { useEditorStore } from "../store";
import { fxCatalog, defaultTapLengthS } from "../fx/catalog";
import type { FxKind } from "../fx/types";

interface PadDef {
  slotKey: string;
  kind: FxKind;
}

const PADS: readonly PadDef[] = [{ slotKey: "pad:0", kind: "vignette" }];

const EDGE_H = 16;       // top-edge strip height (also collapsed-state full)
const EXPANDED_BODY_H = 76; // pad row body height in expanded state
const EXPANDED_TOTAL_H = EDGE_H + EXPANDED_BODY_H;

export function FxHardwarePanel() {
  const fxPanelOpen = useEditorStore((s) => s.ui.fxPanelOpen);
  const setFxPanelOpen = useEditorStore((s) => s.setFxPanelOpen);
  const isMobile = useIsCoarsePointer();
  const open = isMobile || fxPanelOpen;

  // In collapsed state pull the panel up to absorb most of the parent's
  // gap-3 (12 px) above. The tab then reads as a divider rather than a
  // standalone block — matches the user's "Konsistenz mit Player→Timeline"
  // request without doubling the spacing.
  const marginTop = open ? 0 : -8;

  return (
    <div
      className="relative w-full select-none"
      style={{
        height: open ? EXPANDED_TOTAL_H : EDGE_H,
        marginTop,
        transition: "height 200ms ease-out, margin-top 200ms ease-out",
      }}
    >
      <EdgeStrip
        open={open}
        toggleable={!isMobile}
        onToggle={() => setFxPanelOpen(!fxPanelOpen)}
      />
      {open && <PadBody />}
    </div>
  );
}

/** Always-visible top-edge strip — same component in collapsed and expanded
 *  states so the user has a stable affordance. Click toggles visibility on
 *  desktop; on mobile the click is a no-op (the panel can't collapse). */
function EdgeStrip({
  open,
  toggleable,
  onToggle,
}: {
  open: boolean;
  toggleable: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={toggleable ? onToggle : undefined}
      aria-label={open ? "Hide FX panel" : "Show FX panel"}
      title={toggleable ? (open ? "Hide FX panel" : "Show FX panel") : undefined}
      className="relative w-full block focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
      style={{
        height: EDGE_H,
        cursor: toggleable ? "pointer" : "default",
        ...EDGE_STRIP_STYLE,
      }}
    >
      {/* Knurled grip bar — wider than before so the affordance reads
       *  clearly as "drag-handle / pull tab". */}
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{
          height: 8,
          width: 64,
          borderRadius: 1,
          ...KNURLED_GRIP,
        }}
      />
      {/* Label on the left so it's clear what panel this opens. */}
      <span
        aria-hidden
        className="absolute left-3 top-1/2 -translate-y-1/2 font-display text-[9px] uppercase tracking-label"
        style={EDGE_LABEL_STYLE}
      >
        FX
      </span>
      {/* Chevron on the right indicating direction. */}
      {toggleable && (
        <span
          aria-hidden
          className="absolute right-3 top-1/2 -translate-y-1/2 font-display text-[10px] leading-none"
          style={EDGE_LABEL_STYLE}
        >
          {open ? "▾" : "▴"}
        </span>
      )}
    </button>
  );
}

function PadBody() {
  return (
    <div className="relative w-full" style={{ height: EXPANDED_BODY_H, ...MECHANISM_BODY }}>
      {/* Vier Phillips-Schrauben in den Ecken. */}
      <Screw left={6} top={6} />
      <Screw right={6} top={6} />
      <Screw left={6} bottom={6} />
      <Screw right={6} bottom={6} />

      {/* Etched horizontal grain. */}
      <div aria-hidden className="absolute inset-0 pointer-events-none" style={BRUSHED_GRAIN} />

      <div className="relative h-full flex items-center gap-3 px-5">
        <Lcd />
        <div className="flex items-center gap-2">
          {PADS.map((p) => (
            <FxPad key={p.slotKey} pad={p} />
          ))}
        </div>
      </div>
    </div>
  );
}

function FxPad({ pad }: { pad: PadDef }) {
  const def = fxCatalog[pad.kind];
  const heldByThisSlot = useEditorStore((s) => Boolean(s.fxHolds[pad.slotKey]));
  const beginFxHold = useEditorStore((s) => s.beginFxHold);
  const endFxHold = useEditorStore((s) => s.endFxHold);
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
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* capture not supported */
    }
    const s = useEditorStore.getState();
    const t = s.snapMasterTime(s.playback.currentTime);
    beginFxHold(pad.slotKey, pad.kind, t);
  }
  function handleUp() {
    endFxHold(pad.slotKey);
  }

  return (
    <motion.button
      type="button"
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      whileTap={{ scale: 0.94 }}
      transition={{ duration: 0.05, ease: "easeOut" }}
      aria-label={`Trigger ${def.label}`}
      title={`${def.label} — hold to play`}
      className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
      style={padBodyStyle(heldByThisSlot, def.capsuleColor, glow)}
    >
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
  const bpm = useEditorStore((s) => s.jobMeta?.bpm?.value ?? null);
  const def = fxCatalog[PADS[0].kind];
  const intensityDefault = def.defaultParams.intensity ?? 0;
  const tapLen = defaultTapLengthS(PADS[0].kind, bpm);
  return (
    <div
      aria-hidden
      className="flex flex-col justify-center px-2 py-1 rounded-sm font-mono leading-tight"
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
        width: 7,
        height: 7,
        borderRadius: "50%",
        background:
          "radial-gradient(circle at 35% 30%, #DCD3BB 0%, #ADA28A 55%, #837A66 100%)",
        boxShadow:
          "inset 0 -1px 0 rgba(0,0,0,0.35), 0 0.5px 0.5px rgba(0,0,0,0.4)",
      }}
    >
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
    const legacy = mql as unknown as {
      addListener?: (cb: (ev: MediaQueryListEvent) => void) => void;
      removeListener?: (cb: (ev: MediaQueryListEvent) => void) => void;
    };
    legacy.addListener?.(onChange);
    return () => legacy.removeListener?.(onChange);
  }, []);
  return coarse;
}

const EDGE_STRIP_STYLE: CSSProperties = {
  background:
    "linear-gradient(180deg, #E8E1D0 0%, #D5CAA8 52%, #C9BFA6 100%)",
  borderTop: "1px solid rgba(26,24,22,0.22)",
  borderBottom: "1px solid rgba(26,24,22,0.22)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.55)",
    "inset 0 -1px 0 rgba(0,0,0,0.10)",
  ].join(", "),
};

const EDGE_LABEL_STYLE: CSSProperties = {
  color: "rgba(26,24,22,0.6)",
  textShadow: "0 0.5px 0 rgba(255,255,255,0.5)",
};

const KNURLED_GRIP: CSSProperties = {
  background:
    "repeating-linear-gradient(90deg, rgba(26,24,22,0.22) 0px, rgba(26,24,22,0.22) 1px, rgba(255,255,255,0.55) 1px, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 3px)",
  boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
};

const MECHANISM_BODY: CSSProperties = {
  background: "linear-gradient(180deg, #2A2722 0%, #1A1816 100%)",
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
  width: 80,
  height: 50,
};

function padBodyStyle(
  pressed: boolean,
  ledColor: string,
  glow: number,
): CSSProperties {
  return {
    width: 60,
    height: 50,
    minWidth: 48,
    minHeight: 48,
    background: "linear-gradient(180deg, #4A4640 0%, #2C2925 100%)",
    border: "1px solid rgba(0,0,0,0.7)",
    boxShadow: [
      "inset 0 1px 1px rgba(255,255,255,0.08)",
      "inset 0 -1px 1px rgba(0,0,0,0.6)",
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
