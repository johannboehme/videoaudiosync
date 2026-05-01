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
 *   - Expanded: container grows to ~122 px and goes back into normal
 *     flex flow (mt/mb 0). LCD + 2 encoders + pads render below the tab.
 *     Re-clicking the same tab collapses again.
 *
 * Mobile (`pointer: coarse`): always expanded — pads are the only trigger
 *   without a keyboard. Tab is non-interactive on mobile.
 *
 * Recording-Head-Semantik:
 *   - Pad-Press (Tastatur oder Maus) → setzt `selectedFxKind` + startet
 *     `beginFxHold` mit den aktuellen `fxDefaults[kind]`-Werten.
 *   - Encoder-Drehen → schreibt `setFxDefault(kind, paramId, …)`. Die
 *     bereits gepunchten Capsules auf der Timeline sind frozen und
 *     bleiben unangetastet — du editierst nur, was als nächstes
 *     geschrieben wird (wie eine Tape-Maschine).
 */
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useEditorStore } from "../store";
import { fxCatalog, defaultTapLengthS } from "../fx/catalog";
import type { FxKind, FxParamDef } from "../fx/types";
import { useIsNarrowViewport } from "../use-is-narrow";

interface PadDef {
  slotKey: string;
  kind: FxKind;
  /** Single-character keyboard letter shown on the pad. */
  letter: string;
}

const PADS: readonly PadDef[] = [
  { slotKey: "pad:0", kind: "vignette", letter: "V" },
  { slotKey: "pad:1", kind: "wear", letter: "W" },
  { slotKey: "pad:2", kind: "echo", letter: "E" },
  { slotKey: "pad:3", kind: "rgb", letter: "R" },
  { slotKey: "pad:4", kind: "tape", letter: "T" },
  { slotKey: "pad:5", kind: "zoom", letter: "Z" },
  { slotKey: "pad:6", kind: "uv", letter: "U" },
];

/** Beat-division stops for bipolar encoders (TE-LFO style). */
const BEAT_STOPS = ["1/16", "1/8", "1/4", "1/2", "1", "2", "4"] as const;

const TAB_H = 12;
const PAD_BODY_H = 110;
// Mobile pad layout pieces — used to compute panel height per-viewport
// so the bottom padding under the pad row matches the top padding
// above the LCD (`py-1.5` = 6 px). At fold-folded (280 px wide) we get
// 3 pads per row → 3 rows; at iPhone-12 (390) we get 5 → 2 rows; at
// 540+ we get 7 → 1 row. The earlier static 256 value was tuned to
// the worst case (3 rows) and left ~36 px of dead space below the
// pads on iPhone-class viewports — exactly the "viel platz unten"
// the user spotted.
const PAD_SIZE_NARROW = 60; // pad width = pad height on phones
const PAD_GAP_NARROW = 4; // matches `gap-1` in the JSX below
const LCD_ROW_H_NARROW = 78; // LCD is the tallest item in the top row
const PADBODY_INNER_PY_NARROW = 12; // 2× py-1.5
const PADBODY_INNER_PX_NARROW = 16; // 2× px-2
const PADBODY_INNER_GAP_NARROW = 6; // gap-1.5 between LCD row and pad row
function padBodyHeightNarrow(rows: number): number {
  return (
    LCD_ROW_H_NARROW +
    PADBODY_INNER_GAP_NARROW +
    rows * PAD_SIZE_NARROW +
    (rows - 1) * PAD_GAP_NARROW +
    PADBODY_INNER_PY_NARROW
  );
}
function padsPerRowNarrow(containerCssWidth: number): number {
  // The pad row sits inside `px-2` (16) of the panel body. Each pad is
  // 60 px wide and the inter-pad gap is `gap-1` (4 px).
  const inner = Math.max(0, containerCssWidth - PADBODY_INNER_PX_NARROW);
  const fits = Math.floor((inner + PAD_GAP_NARROW) / (PAD_SIZE_NARROW + PAD_GAP_NARROW));
  return Math.max(1, Math.min(PADS.length, fits));
}
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
  const isNarrow = useIsNarrowViewport();
  // Mobile users asked to be able to fold the FX panel away on demand —
  // before it was permanently expanded (open = isMobile || ...). Now it
  // tracks the same `fxPanelOpen` flag everywhere; the tab is always
  // toggleable, so a coarse-pointer user can also press the pull-tab to
  // collapse / expand the pad bank.
  const open = fxPanelOpen;

  // On mobile we measure the panel's actual rendered width (via a
  // ResizeObserver) so we can derive the exact pad-row count → exact
  // panel height. The earlier static `PAD_BODY_H_NARROW = 256` was
  // sized for the worst case (3 rows of pads at fold-folded) and left
  // ~36 px of dead space under the pads on iPhone-class viewports
  // where the pads actually fit in 2 rows. Now the bottom padding
  // matches the LCD's top padding (`py-1.5` = 6 px) at every width.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !isNarrow) return;
    const apply = () => setContainerW(el.clientWidth);
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, [isNarrow]);
  const padRowsNarrow = Math.ceil(PADS.length / padsPerRowNarrow(containerW || 280));
  const padBodyH = isNarrow ? padBodyHeightNarrow(padRowsNarrow) : PAD_BODY_H;
  const expandedH = TAB_H + padBodyH;

  // Margin strategy:
  //   - Desktop: gap-3 (12 px) parent gap. We pull the panel up by 12
  //     and down by 12 so the tab fits exactly into the parent gap and
  //     reads as a single "drawer pulled out of the timeline" silhouette
  //     spanning both transport-bottom and timeline-top edges.
  //   - Mobile: gap-2 (8 px) parent gap. The user wants the tab to
  //     attach to the timeline panel below (drawer handle pulled out
  //     OF the snap panel) but keep visible breathing room from the
  //     transport panel above. So we leave mt:0 (parent gap renders
  //     above the tab) and set mb:-8 to pull the next sibling
  //     (timeline panel) flush against the tab's bottom edge.
  const marginTopPx = isNarrow ? 0 : -12;
  const marginBottomPx = isNarrow ? -8 : -12;
  return (
    <div
      ref={containerRef}
      className="relative shrink-0 w-full select-none"
      style={{
        height: open ? expandedH : TAB_H,
        marginTop: marginTopPx,
        marginBottom: marginBottomPx,
        overflow: "visible",
        transition: "height 200ms ease-out",
      }}
    >
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
            height: padBodyH,
          }}
        >
          <PadBody narrow={isNarrow} />
        </div>
      </div>
      <Tab
        open={open}
        onClick={() => setFxPanelOpen(!fxPanelOpen)}
        toggleable
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
        borderRadius: "6px 6px 0 0",
        cursor: toggleable ? "pointer" : "default",
        ...ALUMINUM_BODY,
        borderBottom: "none",
      }}
    >
      {/* Tap-area extender — invisible, expands the hit-rect to ~36 px
       *  tall × 144 px wide so a fingertip can grab the 12 px tab on
       *  touch devices. Clicks on this transparent overlay still
       *  trigger the parent button's onClick. */}
      <span
        aria-hidden
        className="absolute"
        style={{ left: -16, right: -16, top: -12, bottom: -12 }}
      />
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

function PadBody({ narrow = false }: { narrow?: boolean }) {
  const selectedFxKind = useEditorStore((s) => s.selectedFxKind);
  const def = fxCatalog[selectedFxKind];

  return (
    <div className="relative w-full h-full" style={MECHANISM_BODY}>
      <Screw left={5} top={5} />
      <Screw right={5} top={5} />
      <Screw left={5} bottom={5} />
      <Screw right={5} bottom={5} />

      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={BRUSHED_GRAIN}
      />

      {narrow ? (
        // Narrow phones: stack the LCD/encoders on top, then a wrapped
        // pad grid below. The earlier version used `mt-auto` to push
        // the pads to the bottom of a 286 px container, creating ~30
        // px of wasted space between the encoder row and the pad bank.
        // We now flow the pads directly under the encoders (no
        // `mt-auto`) and tighten paddings to py-1.5 so the panel
        // body shrinks from 286 → 256 px on mobile.
        <div className="relative h-full flex flex-col gap-1.5 px-2 py-1.5">
          <div className="flex items-center gap-2 shrink-0">
            <Lcd kind={selectedFxKind} />
            {def.params && (
              <div className="flex items-end gap-2 self-center ml-auto">
                <Encoder
                  kind={selectedFxKind}
                  param={def.params[0]}
                  tint={ENCODER_HOT}
                />
                <Encoder
                  kind={selectedFxKind}
                  param={def.params[1]}
                  tint={ENCODER_COBALT}
                />
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-1 justify-center">
            {PADS.map((p) => (
              <FxPad key={p.slotKey} pad={p} />
            ))}
          </div>
        </div>
      ) : (
        <div className="relative h-full flex items-center gap-3 px-5">
          <Lcd kind={selectedFxKind} />
          {def.params && (
            <div className="flex items-end gap-3 self-center">
              <Encoder
                kind={selectedFxKind}
                param={def.params[0]}
                tint={ENCODER_HOT}
              />
              <Encoder
                kind={selectedFxKind}
                param={def.params[1]}
                tint={ENCODER_COBALT}
              />
            </div>
          )}
          <Divider />
          <div className="flex items-center gap-2">
            {PADS.map((p) => (
              <FxPad key={p.slotKey} pad={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// — Pad ————————————————————————————————————————————————————

function FxPad({ pad }: { pad: PadDef }) {
  const def = fxCatalog[pad.kind];
  const heldByThisSlot = useEditorStore((s) => Boolean(s.fxHolds[pad.slotKey]));
  const isSelected = useEditorStore((s) => s.selectedFxKind === pad.kind);
  const beginFxHold = useEditorStore((s) => s.beginFxHold);
  const endFxHold = useEditorStore((s) => s.endFxHold);
  const setSelectedFxKind = useEditorStore((s) => s.setSelectedFxKind);
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
    // We deliberately don't `setPointerCapture` here — capture works
    // fine for one finger but on Android Chrome routes additional
    // touch pointers in unpredictable ways, swallowing the second
    // pad's pointerdown so multi-touch chords (V + W to overlay
    // vignette + wear) silently drop one of the two. Without capture,
    // each finger's pointerdown lands on the pad it touched, both
    // store entries get added, both pads light up.
    //
    // We also drop `e.stopPropagation()` for the same reason: when
    // the FX panel is wrapped in a container with its own pointer
    // listener (e.g. the editor's no-long-press handler), stopping
    // propagation can leave the container's "active touch" tracker
    // out of sync and cancel sibling pointers.
    setSelectedFxKind(pad.kind);
    const s = useEditorStore.getState();
    const t = s.snapMasterTime(s.playback.currentTime);
    beginFxHold(pad.slotKey, pad.kind, t);
  }
  function handleUp() {
    endFxHold(pad.slotKey);
  }
  // Tap-feedback transform replaces framer-motion's `whileTap`. Framer
  // installs document-level pointer listeners to drive that animation,
  // and on Android Chrome those listeners interfere with sibling pads'
  // multi-touch routing (the second pad's pointerdown gets eaten by
  // framer's "this tap is for the first pad" tracker). Pure CSS scale
  // sidesteps the issue and looks identical.
  const pressScale = heldByThisSlot ? 0.94 : 1;

  return (
    <button
      type="button"
      onPointerDown={handleDown}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      // Suppress the system long-press callout — pads are hold-to-play,
      // and on Android Chrome the platform "save / share" menu used to
      // hijack the gesture and abort the FX hold.
      onContextMenu={(e) => e.preventDefault()}
      aria-label={`Trigger ${def.label}`}
      title={`${def.label} — hold to play (${pad.letter})`}
      className="relative rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-hot/40"
      style={{
        ...padBodyStyle(heldByThisSlot, isSelected, def.capsuleColor, glow),
        WebkitTouchCallout: "none",
        WebkitUserSelect: "none",
        userSelect: "none",
        touchAction: "none",
        transform: `scale(${pressScale})`,
        transition: "transform 50ms ease-out",
      }}
    >
      {/* keyboard letter — top-left, small etched */}
      <span
        aria-hidden
        className="absolute left-1.5 top-1 leading-none"
        style={{
          fontSize: 8,
          letterSpacing: 0.6,
          color: "rgba(255,255,255,0.55)",
          textShadow: "0 1px 0 rgba(0,0,0,0.55)",
          fontFamily:
            '"JetBrains Mono Variable", ui-monospace, monospace',
          fontWeight: 700,
        }}
      >
        {pad.letter}
      </span>
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
    </button>
  );
}

// — LCD ————————————————————————————————————————————————————

function Lcd({ kind }: { kind: FxKind }) {
  const def = fxCatalog[kind];
  const bpm = useEditorStore((s) => s.jobMeta?.bpm?.value ?? null);
  const tapLen = defaultTapLengthS(kind, bpm);
  // Subscribe to the per-kind defaults map so the LCD updates the moment
  // an encoder writes — pulling the slice for THIS kind only keeps the
  // re-render local.
  const fxDefaults = useEditorStore((s) => s.fxDefaults[kind]);

  const params = def.params;
  const v1 = params
    ? fxDefaults?.[params[0].id] ?? params[0].defaultValue
    : null;
  const v2 = params
    ? fxDefaults?.[params[1].id] ?? params[1].defaultValue
    : null;

  return (
    <div
      aria-hidden
      className="relative flex flex-col justify-between leading-tight"
      style={LCD_STYLE}
    >
      {/* horizontal scan-line overlay — sells the "phosphor" feel */}
      <div
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            "repeating-linear-gradient(0deg, rgba(0,0,0,0.18) 0 1px, transparent 1px 2px)",
          mixBlendMode: "multiply",
          borderRadius: 2,
        }}
      />
      <div className="relative flex flex-col h-full justify-between px-2 py-1.5">
        <div
          className="flex items-baseline justify-between"
          style={{ ...LCD_TEXT_DIM, fontSize: 7, letterSpacing: 1.4 }}
        >
          <span>VAS · FX</span>
          <span>{tapLen.toFixed(2)}S</span>
        </div>
        <div
          style={{
            fontFamily:
              '"JetBrains Mono Variable", ui-monospace, monospace',
            fontSize: 22,
            letterSpacing: 2,
            lineHeight: 1,
            fontWeight: 700,
            ...LCD_TEXT,
          }}
        >
          {def.label}
        </div>
        {params && v1 !== null && v2 !== null ? (
          <div
            className="flex justify-between items-baseline"
            style={{
              fontFamily:
                '"JetBrains Mono Variable", ui-monospace, monospace',
              fontSize: 9,
              letterSpacing: 0.5,
              ...LCD_TEXT,
            }}
          >
            <span>
              <span style={LCD_HOT_DOT}>●</span>{" "}
              {params[0].label} {fmt(params[0], v1)}
            </span>
            <span>
              <span style={LCD_COBALT_DOT}>●</span>{" "}
              {params[1].label} {fmt(params[1], v2)}
            </span>
          </div>
        ) : (
          <div
            style={{
              ...LCD_TEXT_DIM,
              fontSize: 8,
              letterSpacing: 1,
              fontFamily:
                '"JetBrains Mono Variable", ui-monospace, monospace',
            }}
          >
            NO PARAMS
          </div>
        )}
      </div>
    </div>
  );
}

// — Encoder ————————————————————————————————————————————————

interface EncoderProps {
  kind: FxKind;
  param: FxParamDef;
  tint: string;
}

/** Skeuomorpher 80er-Hardware-Pot:
 *  - matter schwarzer Mantel (Bakelit-Look) mit Knurled-Ring
 *  - poliertes, leicht erhabenes Cap-Top mit fixem Top-Left-Reflex (Lichtquelle steht)
 *  - dünne, getintete Indikator-Linie auf dem Cap — die ROTIERT mit dem Wert
 *    und ist gleichzeitig die Farb-Kodierung des Encoders
 *  - SVG-Skala um den Knob herum mit Tick-Filling in derselben Tint-Farbe.
 *
 *  Drag-Verhalten: vertikal ziehen, 200 px = full sweep. Shift = fine
 *  (6×). Doppelklick reset auf catalog-Default. Shift+Pfeile auf Tastatur
 *  nudgen feiner (vgl. existing Knob.tsx).
 */
function Encoder({ kind, param, tint }: EncoderProps) {
  const fxDefaults = useEditorStore((s) => s.fxDefaults[kind]);
  const setFxDefault = useEditorStore((s) => s.setFxDefault);
  const value = fxDefaults?.[param.id] ?? param.defaultValue;

  const startY = useRef(0);
  const startVal = useRef(0);
  const [dragging, setDragging] = useState(false);

  const range = param.max - param.min;
  // Display sweep is 0..1 regardless of storage range; angle -135..+135.
  const ratio = Math.max(
    0,
    Math.min(1, range > 0 ? (value - param.min) / range : 0),
  );
  const angle = -135 + ratio * 270;

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      const target = e.currentTarget;
      target.setPointerCapture(e.pointerId);
      e.preventDefault();
      // Click-on-scale shortcut: if the click lands outside the knob body
      // (i.e. on the etched scale ring) we map the click angle to a value
      // and jump there immediately. Drag continues from the new baseline,
      // so click → release ist "instant set" and click → drag is "set then
      // fine-tune". Inside the knob body we keep pure drag-only.
      const rect = target.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const r = Math.hypot(dx, dy);
      // Knob-Body-Radius mit 1 px Toleranz; Klicks außerhalb → Skala.
      const KNOB_HIT_R = ENC_BODY / 2 + 1;
      let baseline = value;
      if (r > KNOB_HIT_R) {
        // Click angle: top = 0, right-half positive, left-half negative.
        // atan2(dx, -dy) gives exactly that orientation.
        const aDeg = (Math.atan2(dx, -dy) * 180) / Math.PI;
        const clamped = Math.max(-135, Math.min(135, aDeg));
        const ratioFromClick = (clamped + 135) / 270;
        let next = param.min + ratioFromClick * range;
        if (param.kind === "bipolar") {
          next = snapBipolar(next, param.min, param.max);
        } else {
          const decimals = range <= 1.5 ? 2 : 0;
          next = roundTo(next, decimals);
        }
        setFxDefault(kind, param.id, next);
        baseline = next;
      }
      startY.current = e.clientY;
      startVal.current = baseline;
      setDragging(true);
    },
    [
      value,
      kind,
      param.id,
      param.kind,
      param.min,
      param.max,
      range,
      setFxDefault,
    ],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      e.preventDefault();
      // Drag UP increases the value. 200 px maps to the full storage
      // range; Shift slows this 6×.
      const dy = startY.current - e.clientY;
      const sensitivity = e.shiftKey ? 1200 : 200;
      let next = startVal.current + (dy / sensitivity) * range;
      next = Math.max(param.min, Math.min(param.max, next));
      if (param.kind === "bipolar") {
        next = snapBipolar(next, param.min, param.max);
      } else {
        // Round to a sensible step. For 0..1 ranges, two decimals; for
        // 0..100 ranges, integers; pick whichever makes sense from the
        // range size.
        const decimals = range <= 1.5 ? 2 : 0;
        next = roundTo(next, decimals);
      }
      setFxDefault(kind, param.id, next);
    },
    [dragging, kind, param.id, param.kind, param.min, param.max, range, setFxDefault],
  );

  const onPointerUp = useCallback(() => setDragging(false), []);

  const onDoubleClick = useCallback(() => {
    setFxDefault(kind, param.id, param.defaultValue);
  }, [kind, param.id, param.defaultValue, setFxDefault]);

  return (
    <div className="flex flex-col items-center" style={{ gap: 3 }}>
      <div
        role="slider"
        aria-valuemin={param.min}
        aria-valuemax={param.max}
        aria-valuenow={value}
        aria-label={param.label}
        tabIndex={0}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        className="relative touch-none cursor-grab active:cursor-grabbing"
        style={{ width: ENC_OUTER, height: ENC_OUTER }}
      >
        {/* etched scale around the knob */}
        <svg
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          viewBox="-50 -50 100 100"
          width={ENC_OUTER}
          height={ENC_OUTER}
        >
          {param.kind === "linear"
            ? linearTicks(ratio, tint)
            : bipolarTicks(value, param.min, param.max, tint)}
        </svg>

        {/* knob body — matte black, fixed (does NOT rotate; the indicator does) */}
        <div
          aria-hidden
          className="absolute rounded-full"
          style={{
            left: ENC_BODY_INSET,
            top: ENC_BODY_INSET,
            width: ENC_BODY,
            height: ENC_BODY,
            background:
              "radial-gradient(circle at 32% 22%, #2C2A26 0%, #16140F 65%, #050402 100%)",
            boxShadow: [
              // crisp drop-shadow under the knob — sells the "raised over the plate" feel
              "0 3px 4px -1px rgba(0,0,0,0.6)",
              "0 1px 0 rgba(0,0,0,0.4)",
              // subtle inner top-rim highlight, fixed lighting
              "inset 0 1px 0 rgba(255,255,255,0.10)",
              // bottom-half darken — sphere-ish curvature
              "inset 0 -3px 6px rgba(0,0,0,0.55)",
            ].join(", "),
          }}
        />

        {/* knurled ring — outer 2-3px annulus with conic grooves */}
        <div
          aria-hidden
          className="absolute rounded-full pointer-events-none"
          style={{
            left: ENC_BODY_INSET,
            top: ENC_BODY_INSET,
            width: ENC_BODY,
            height: ENC_BODY,
            background:
              "repeating-conic-gradient(from 0deg, rgba(255,255,255,0.10) 0deg 1.5deg, rgba(0,0,0,0.55) 1.5deg 3deg)",
            // mask to a thin ring at the body's outer edge
            WebkitMask:
              "radial-gradient(circle, transparent 70%, black 78%, black 96%, transparent 100%)",
            mask: "radial-gradient(circle, transparent 70%, black 78%, black 96%, transparent 100%)",
          }}
        />

        {/* polished cap — slightly raised, lighter, fixed top-left highlight */}
        <div
          aria-hidden
          className="absolute rounded-full"
          style={{
            left: ENC_CAP_INSET,
            top: ENC_CAP_INSET,
            width: ENC_CAP,
            height: ENC_CAP,
            background:
              "radial-gradient(circle at 32% 22%, #4A4640 0%, #2A2722 55%, #14110E 100%)",
            boxShadow: [
              "inset 0 1px 0 rgba(255,255,255,0.16)",
              "inset 0 -1px 1px rgba(0,0,0,0.6)",
              "0 1px 1px rgba(0,0,0,0.4)",
            ].join(", "),
          }}
        >
          {/* fixed specular highlight — does NOT rotate (light source is overhead) */}
          <span
            aria-hidden
            className="absolute rounded-full pointer-events-none"
            style={{
              top: 2,
              left: 3,
              width: ENC_CAP * 0.45,
              height: ENC_CAP * 0.32,
              background:
                "radial-gradient(ellipse at center, rgba(255,255,255,0.30) 0%, rgba(255,255,255,0.08) 55%, transparent 100%)",
              filter: "blur(0.5px)",
            }}
          />
        </div>

        {/* indicator — thin colored line that ROTATES with value.
         *  Color = encoder tint. This IS the entire color marker on the
         *  encoder; the knob itself stays neutral black so it reads as
         *  hardware, not "UI element". */}
        <div
          aria-hidden
          className="absolute pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            width: 0,
            height: 0,
            transform: `translate(-50%, -50%) rotate(${angle}deg)`,
            transition: dragging ? "none" : "transform 80ms ease-out",
          }}
        >
          <span
            aria-hidden
            className="absolute"
            style={{
              left: "50%",
              top: -ENC_CAP / 2 + 2,
              transform: "translate(-50%, 0)",
              width: 2,
              height: 7,
              borderRadius: 1,
              background: tint,
              boxShadow: `0 0 3px ${tint}cc, 0 0 1px ${tint}, inset 0 0 0 0.5px rgba(0,0,0,0.5)`,
            }}
          />
        </div>

        {/* tiny etched centre divot — gives the cap a 3D "machined" feel */}
        <span
          aria-hidden
          className="absolute rounded-full pointer-events-none"
          style={{
            left: "50%",
            top: "50%",
            width: 2.5,
            height: 2.5,
            transform: "translate(-50%, -50%)",
            background: "rgba(0,0,0,0.7)",
            boxShadow: "0 0.5px 0 rgba(255,255,255,0.06)",
          }}
        />
      </div>

      {/* engraved label below */}
      <span
        style={{
          fontSize: 7.5,
          letterSpacing: 1.5,
          color: "rgba(245,240,225,0.5)",
          textShadow: "0 1px 0 rgba(0,0,0,0.55)",
          fontWeight: 700,
          textTransform: "uppercase",
          fontFamily:
            '"JetBrains Mono Variable", ui-monospace, monospace',
          lineHeight: 1,
        }}
      >
        {param.label}
      </span>
    </div>
  );
}

// — Tick rendering ————————————————————————————————————————

function linearTicks(ratio: number, fillColor: string) {
  const out = [];
  const TICK_COUNT = 21;
  for (let i = 0; i < TICK_COUNT; i++) {
    const t = i / (TICK_COUNT - 1);
    const a = ((-135 + t * 270) * Math.PI) / 180;
    const offsetA = a - Math.PI / 2; // SVG: angle 0 = right; we want top.
    const major = i % 5 === 0;
    const r1 = 49;
    const r2 = major ? 41 : 45;
    const filled = t <= ratio;
    out.push(
      <line
        key={i}
        x1={Math.cos(offsetA) * r1}
        y1={Math.sin(offsetA) * r1}
        x2={Math.cos(offsetA) * r2}
        y2={Math.sin(offsetA) * r2}
        stroke={filled ? fillColor : "rgba(245,240,225,0.18)"}
        strokeWidth={major ? 1.4 : 0.8}
        strokeLinecap="round"
      />,
    );
  }
  return out;
}

function bipolarTicks(
  value: number,
  min: number,
  max: number,
  fillColor: string,
) {
  // Center is the midpoint of the storage range.
  const range = max - min;
  const center = min + range / 2;
  const out = [];
  // Free side: fine grey ticks running from -135° to 0° (left half).
  const FREE_TICKS = 9;
  for (let i = 0; i < FREE_TICKS; i++) {
    const t = i / (FREE_TICKS - 1);
    const a = (-135 + t * 135) * (Math.PI / 180) - Math.PI / 2;
    const r1 = 49;
    const r2 = 46;
    const lit = value < center && t >= 1 - (center - value) / (range / 2);
    out.push(
      <line
        key={`f${i}`}
        x1={Math.cos(a) * r1}
        y1={Math.sin(a) * r1}
        x2={Math.cos(a) * r2}
        y2={Math.sin(a) * r2}
        stroke={lit ? fillColor : "rgba(245,240,225,0.18)"}
        strokeWidth={0.7}
        strokeLinecap="round"
      />,
    );
  }
  // Centre detent — fat tick at the very top.
  const cAng = -Math.PI / 2;
  out.push(
    <line
      key="centre"
      x1={Math.cos(cAng) * 49}
      y1={Math.sin(cAng) * 49}
      x2={Math.cos(cAng) * 39}
      y2={Math.sin(cAng) * 39}
      stroke={value === center ? fillColor : "rgba(245,240,225,0.42)"}
      strokeWidth={1.8}
      strokeLinecap="round"
    />,
  );
  // Sync side: 7 prominent stops at even angular spacing across right half.
  for (let i = 0; i < BEAT_STOPS.length; i++) {
    const t = (i + 0.5) / BEAT_STOPS.length; // centre of bucket (0.5..1.0)
    const a = ((t * 135 + 0) * Math.PI) / 180 - Math.PI / 2;
    // Map current value → stop index on right half if value > centre.
    const rightSide = value > center;
    const halfRange = range / 2;
    const stopIdx = rightSide
      ? Math.min(
          BEAT_STOPS.length - 1,
          Math.max(
            0,
            Math.round(((value - center) / halfRange) * BEAT_STOPS.length - 0.5),
          ),
        )
      : -1;
    const lit = stopIdx === i;
    const r1 = 49;
    const r2 = 39;
    out.push(
      <line
        key={`s${i}`}
        x1={Math.cos(a) * r1}
        y1={Math.sin(a) * r1}
        x2={Math.cos(a) * r2}
        y2={Math.sin(a) * r2}
        stroke={lit ? fillColor : "rgba(245,240,225,0.42)"}
        strokeWidth={1.4}
        strokeLinecap="round"
      />,
    );
  }
  return out;
}

// — Helpers ————————————————————————————————————————————————

function fmt(param: FxParamDef, value: number): string {
  if (param.kind === "bipolar") return bipolarLabel(value, param.min, param.max);
  // Linear: show as 0..100 integer regardless of storage range.
  const ratio = (value - param.min) / (param.max - param.min);
  return String(Math.round(ratio * 100)).padStart(3, " ");
}

function bipolarLabel(value: number, min: number, max: number): string {
  const range = max - min;
  const center = min + range / 2;
  const halfRange = range / 2;
  // ±2% of the range counts as "OFF" detent.
  const detentEps = halfRange * 0.04;
  if (Math.abs(value - center) <= detentEps) return "OFF";
  if (value < center) {
    const dist = Math.round(((center - value) / halfRange) * 100);
    return `FR${String(dist).padStart(2, " ")}`;
  }
  const idx = Math.min(
    BEAT_STOPS.length - 1,
    Math.max(
      0,
      Math.round(((value - center) / halfRange) * BEAT_STOPS.length - 0.5),
    ),
  );
  return BEAT_STOPS[idx];
}

function snapBipolar(raw: number, min: number, max: number): number {
  const range = max - min;
  const center = min + range / 2;
  const halfRange = range / 2;
  const detentEps = halfRange * 0.04;
  if (Math.abs(raw - center) <= detentEps) return center;
  if (raw < center) return raw;
  // Right side: snap to nearest of BEAT_STOPS.length stop centres.
  const t = (raw - center) / halfRange; // 0..1
  const idx = Math.min(
    BEAT_STOPS.length - 1,
    Math.max(0, Math.round(t * BEAT_STOPS.length - 0.5)),
  );
  return center + ((idx + 0.5) / BEAT_STOPS.length) * halfRange;
}

function roundTo(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
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

function Divider() {
  return (
    <div
      aria-hidden
      className="self-stretch my-3"
      style={{
        width: 1,
        background:
          "linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.6) 18%, rgba(0,0,0,0.6) 82%, transparent 100%)",
        boxShadow: "1px 0 0 rgba(255,255,255,0.04)",
      }}
    />
  );
}

// — Constants & styles ————————————————————————————————————

const ENCODER_HOT = "#FF5722";
const ENCODER_COBALT = "#1F4E8C";

const ENC_OUTER = 50;
const ENC_BODY = 36;
const ENC_BODY_INSET = (ENC_OUTER - ENC_BODY) / 2;
const ENC_CAP = 28;
const ENC_CAP_INSET = (ENC_OUTER - ENC_CAP) / 2;

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
  background: "linear-gradient(180deg, #181513 0%, #0E0C0A 100%)",
  borderTop: "1px solid rgba(0,0,0,0.7)",
  borderLeft: "1px solid rgba(0,0,0,0.65)",
  borderRight: "1px solid rgba(0,0,0,0.65)",
  borderBottom: "none",
  borderRadius: "6px 6px 0 0",
  boxShadow: [
    "inset 0 5px 8px -2px rgba(0,0,0,0.55)",
    "inset 0 -8px 12px -2px rgba(0,0,0,0.75)",
    "inset 4px 0 8px -3px rgba(0,0,0,0.5)",
    "inset -4px 0 8px -3px rgba(0,0,0,0.5)",
  ].join(", "),
};

const BRUSHED_GRAIN: CSSProperties = {
  background:
    "repeating-linear-gradient(90deg, transparent 0, transparent 1px, rgba(255,255,255,0.025) 1px, rgba(255,255,255,0.025) 2px), linear-gradient(180deg, rgba(255,255,255,0.04) 0%, transparent 100%)",
};

const LCD_STYLE: CSSProperties = {
  width: 158,
  height: 78,
  background: "linear-gradient(180deg, #1A2418 0%, #1F2A1E 100%)",
  border: "1px solid rgba(0,0,0,0.7)",
  borderRadius: 3,
  boxShadow: [
    "inset 0 1px 1px rgba(0,0,0,0.7)",
    "inset 0 -1px 1px rgba(255,255,255,0.04)",
    "0 0 0 2px rgba(0,0,0,0.35)",
  ].join(", "),
};

const LCD_TEXT: CSSProperties = {
  color: "#9FE08E",
  textShadow: "0 0 4px rgba(159,224,142,0.55), 0 0 1px rgba(159,224,142,0.9)",
  fontWeight: 600,
};

const LCD_TEXT_DIM: CSSProperties = {
  color: "#6EA060",
  textShadow: "0 0 3px rgba(110,160,96,0.4)",
  fontWeight: 700,
};

const LCD_HOT_DOT: CSSProperties = {
  color: ENCODER_HOT,
  textShadow: `0 0 4px ${ENCODER_HOT}cc`,
};

const LCD_COBALT_DOT: CSSProperties = {
  color: "#5BC0DE",
  textShadow: "0 0 4px #5BC0DEcc",
};

function padBodyStyle(
  pressed: boolean,
  selected: boolean,
  ledColor: string,
  glow: number,
): CSSProperties {
  return {
    width: 60,
    height: 60,
    minWidth: 48,
    minHeight: 48,
    background: "linear-gradient(180deg, #4A4640 0%, #2C2925 100%)",
    border: selected
      ? `1px solid ${ledColor}`
      : "1px solid rgba(0,0,0,0.7)",
    boxShadow: [
      "inset 0 1px 1px rgba(255,255,255,0.08)",
      "inset 0 -1px 1px rgba(0,0,0,0.6)",
      glow > 0
        ? `0 0 ${8 * glow}px ${ledColor}, 0 0 ${16 * glow}px ${ledColor}`
        : "0 1px 1px rgba(0,0,0,0.4)",
      selected ? `0 0 0 1px ${ledColor}40` : "",
    ]
      .filter(Boolean)
      .join(", "),
    transform: pressed ? "translateY(1px)" : "translateY(0)",
    transition: "box-shadow 220ms ease-out, transform 60ms ease-out, border-color 120ms",
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
