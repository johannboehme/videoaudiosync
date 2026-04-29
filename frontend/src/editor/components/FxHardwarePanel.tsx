/**
 * FX-Hardware-Panel — pill-shaped pull tab in the gap-3 between transport
 * and timeline, plus an expandable pad row.
 *
 * Layout strategy:
 *   - Collapsed: container is 12 px tall with mt:-6 and mb:-6, so it
 *     consumes ZERO net vertical space (it slots exactly into the
 *     existing gap-3 with 6 px breathing room above + below). The tab
 *     itself is a small ~96 × 12 px pill centered in the gap, NOT a
 *     full-width strip — that's why the previous design read as
 *     "abgeschnitten" at the edges.
 *   - Expanded: container grows to ~88 px and goes back into normal
 *     flex flow (mt/mb 0). Pads + LCD render below the tab. Re-clicking
 *     the same tab collapses again.
 *
 * Mobile (`pointer: coarse`): always expanded — pads are the only trigger
 *   without a keyboard. Tab is non-interactive on mobile.
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

const TAB_H = 12;
const PAD_BODY_H = 76;
const EXPANDED_H = TAB_H + PAD_BODY_H; // 88 — tab and pad body touch directly
const TAB_WIDTH = 110;

/**
 * Layout strategy — "drawer pulled out of the timeline":
 *   - Tab is at the TOP of the container (y stays put across states).
 *     mt:-12 always, so tab-top is flush with transport-bottom.
 *   - **Collapsed** (h = TAB_H, mb:-12): the tab fills the existing 12 px
 *     gap-3 between transport and timeline. Zero net layout impact.
 *   - **Expanded** (h = TAB_H + PAD_BODY_H, mb:-12): the tab stays at
 *     top with the compartment (pad body) directly under it (no gap
 *     between them — the tab IS the visual separator from transport).
 *     The compartment is rendered as a recessed cavity (rounded top,
 *     flat bottom merged with timeline-top); the timeline's top
 *     corners go flat in the EditorShell when the FX panel is open
 *     so the silhouette reads as one continuous "drawer pulled out
 *     of the timeline" shape.
 */
export function FxHardwarePanel() {
  const fxPanelOpen = useEditorStore((s) => s.ui.fxPanelOpen);
  const setFxPanelOpen = useEditorStore((s) => s.setFxPanelOpen);
  const isMobile = useIsCoarsePointer();
  const open = isMobile || fxPanelOpen;

  return (
    <div
      className="relative shrink-0 w-full select-none"
      style={{
        height: open ? EXPANDED_H : TAB_H,
        marginTop: -12, // always — tab top is flush with transport-bottom
        marginBottom: -12, // always — pad body / tab bottom flush with timeline-top
        overflow: "visible",
        transition: "height 200ms ease-out",
      }}
    >
      {/* Cavity clip wrapper. As the container grows, this wrapper
       *  grows from height 0 to PAD_BODY_H. The PadBody inside is
       *  anchored to the BOTTOM of the wrapper at fixed height, so as
       *  the cavity opens the contents are progressively revealed
       *  from bottom-up — like a drawer being pulled out of the
       *  timeline. Always rendered so the close animation reverses
       *  cleanly (contents hide top-down as the cavity shrinks). */}
      <div
        className="absolute"
        style={{
          top: TAB_H,
          left: 0,
          right: 0,
          bottom: 0,
          overflow: "hidden",
        }}
      >
        <div
          className="absolute"
          style={{
            bottom: 0,
            left: 0,
            right: 0,
            height: PAD_BODY_H,
          }}
        >
          <PadBody />
        </div>
      </div>
      {/* Tab anchored at TOP of container, embedded in pad body's top-
       *  center in expanded state. Stays put as the container grows. */}
      <Tab
        open={open}
        onClick={() => setFxPanelOpen(!fxPanelOpen)}
        toggleable={!isMobile}
      />
    </div>
  );
}

/** Anodized-aluminum pull-tab — analogue to the right-side PanelHandle.
 *  Sits at the TOP of the panel container, flush against transport-bottom
 *  in both states. Top corners rounded, bottom corners flat (the tab
 *  visually emerges DOWNWARD into the gap when collapsed; in the
 *  expanded state its flat bottom merges with the pad body's flat top
 *  edge — together they form one "drawer with a handle"). */
function Tab({
  open,
  onClick,
  toggleable,
}: {
  open: boolean;
  onClick: () => void;
  toggleable: boolean;
}) {
  return (
    <button
      type="button"
      onClick={toggleable ? onClick : undefined}
      aria-label={open ? "Hide FX panel" : "Show FX panel"}
      title={
        toggleable ? (open ? "Hide FX panel" : "Show FX panel") : undefined
      }
      className="absolute focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
      style={{
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: TAB_WIDTH,
        height: TAB_H,
        // Rounded TOP, flat bottom — the tab pokes UP from where it
        // anchors. Bottom is the "attached" edge (merges with pad body
        // top in expanded, with timeline-top in collapsed).
        borderRadius: "6px 6px 0 0",
        cursor: toggleable ? "pointer" : "default",
        ...ALUMINUM_BODY,
        borderBottom: "none",
      }}
    >
      <span
        aria-hidden
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
        style={{ ...KNURLED_GRIP, height: 6, width: 40, borderRadius: 1 }}
      />
      <span
        aria-hidden
        className="absolute left-2 top-1/2 -translate-y-1/2 font-display leading-none"
        style={{ fontSize: 8, letterSpacing: 0.5, ...ALUMINUM_LABEL }}
      >
        FX
      </span>
      <span
        aria-hidden
        className="absolute right-2 top-1/2 -translate-y-1/2 leading-none"
        style={{ fontSize: 9, ...ALUMINUM_LABEL }}
      >
        {open ? "▴" : "▾"}
      </span>
    </button>
  );
}

function PadBody() {
  return (
    <div className="relative w-full h-full" style={MECHANISM_BODY}>
      <Screw left={5} top={5} />
      <Screw right={5} top={5} />
      <Screw left={5} bottom={5} />
      <Screw right={5} bottom={5} />

      <div aria-hidden className="absolute inset-0 pointer-events-none" style={BRUSHED_GRAIN} />

      <div className="relative h-full flex items-center gap-3 px-4">
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
      /* ignore */
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

const ALUMINUM_BODY: CSSProperties = {
  background:
    "linear-gradient(180deg, #E8E1D0 0%, #D5CAA8 52%, #C9BFA6 100%)",
  border: "1px solid rgba(26,24,22,0.22)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.55)",
    "inset 0 -1px 0 rgba(0,0,0,0.10)",
    "0 1px 1px rgba(0,0,0,0.08)",
  ].join(", "),
};

const ALUMINUM_LABEL: CSSProperties = {
  color: "rgba(26,24,22,0.6)",
  textShadow: "0 0.5px 0 rgba(255,255,255,0.5)",
  fontWeight: 600,
};

const KNURLED_GRIP: CSSProperties = {
  background:
    "repeating-linear-gradient(90deg, rgba(26,24,22,0.22) 0px, rgba(26,24,22,0.22) 1px, rgba(255,255,255,0.55) 1px, rgba(255,255,255,0.55) 2px, transparent 2px, transparent 3px)",
  boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.06)",
};

const MECHANISM_BODY: CSSProperties = {
  // The compartment is a recessed cavity carved into the editor surface
  // ABOVE the timeline — like the inside of a drawer pulled out. The
  // timeline is the elevated "surface" below; the cavity sits below
  // surface level. Inner shadows on all four sides + a STRONG bottom
  // inner shadow make timeline read as raised above the cavity (its
  // edge casts a shadow up into the cavity). NO outer drop shadow —
  // recessed elements don't cast shadows on what's around them.
  background: "linear-gradient(180deg, #181513 0%, #0E0C0A 100%)",
  borderTop: "1px solid rgba(0,0,0,0.7)",
  borderLeft: "1px solid rgba(0,0,0,0.65)",
  borderRight: "1px solid rgba(0,0,0,0.65)",
  borderBottom: "none",
  borderRadius: "6px 6px 0 0", // rounded top (cavity rim), flat bottom
  boxShadow: [
    "inset 0 5px 8px -2px rgba(0,0,0,0.55)", // top inner — surface drops in
    "inset 0 -8px 12px -2px rgba(0,0,0,0.75)", // bottom inner — timeline elevation casts shadow up into cavity
    "inset 4px 0 8px -3px rgba(0,0,0,0.5)", // left wall
    "inset -4px 0 8px -3px rgba(0,0,0,0.5)", // right wall
  ].join(", "),
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
