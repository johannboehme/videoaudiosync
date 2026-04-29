/**
 * BPM segment-LCD with click-to-edit override, plus a sibling time-
 * signature LCD on the same brass plate.
 *
 * The plate is intentionally one piece of "hardware" — both LCDs share
 * a bezel, both swap from soft-green to amber when the user has
 * overridden the auto-detected value, and both use the same
 * scanline/pixel-grid screen treatment. Click either LCD to edit.
 */
import { useState, useRef, useEffect } from "react";
import { useEditorStore } from "../store";
import { effectiveBeatsPerBar } from "../selectors/timing";
import { HardwarePopover } from "./HardwarePopover";

const MIN_BPM = 30;
const MAX_BPM = 240;

/** Time signatures the picker offers. The math only cares about the
 *  numerator (= beatsPerBar); the denominator is for the display label
 *  so a musician sees "6/8" instead of an opaque "6". When several rows
 *  share a numerator we pick the conventional choice (6 → 6/8, 4 → 4/4). */
const SIGNATURES: ReadonlyArray<{ num: number; den: number; label: string }> = [
  { num: 2, den: 4, label: "2/4" },
  { num: 3, den: 4, label: "3/4" },
  { num: 4, den: 4, label: "4/4" },
  { num: 5, den: 4, label: "5/4" },
  { num: 6, den: 8, label: "6/8" },
  { num: 7, den: 8, label: "7/8" },
  { num: 9, den: 8, label: "9/8" },
  { num: 12, den: 8, label: "12/8" },
];

/** LCD chrome shared across both readouts. Pulled to module scope so the
 *  popover chip-row uses the same colours when previewing the selected
 *  signature. */
const LCD_BG = `
  repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px),
  repeating-linear-gradient(90deg, rgba(0,0,0,0.10) 0 1px, transparent 1px 3px),
  radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.06), rgba(0,0,0,0) 60%),
  linear-gradient(180deg, #0E1311 0%, #0A0E0C 100%)
`;
const LCD_SHADOW = [
  "inset 0 1px 0 rgba(255,255,255,0.05)",
  "inset 0 -1px 0 rgba(0,0,0,0.5)",
  "inset 0 0 18px rgba(0,0,0,0.55)",
  "0 1px 0 rgba(255,255,255,0.5)",
].join(", ");
const LCD_GREEN = "#9DEFD0";
const LCD_AMBER = "#FFB347";
const GLOW_GREEN =
  "0 0 5px rgba(157,239,208,0.4), 0 0 1px rgba(157,239,208,0.8)";
const GLOW_AMBER =
  "0 0 6px rgba(255,179,71,0.55), 0 0 1px rgba(255,179,71,0.9)";

export function BpmReadout() {
  const bpm = useEditorStore((s) => s.jobMeta?.bpm);
  const detectedBpm = useEditorStore((s) => s.jobMeta?.detectedBpm);
  const setBpm = useEditorStore((s) => s.setBpm);
  const reset = useEditorStore((s) => s.resetBpmToDetected);
  const beatsPerBar = useEditorStore((s) => effectiveBeatsPerBar(s.jobMeta));
  const setBeatsPerBar = useEditorStore((s) => s.setBeatsPerBar);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [tsOpen, setTsOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const tsTriggerRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  function startEdit() {
    if (!bpm) return;
    setDraft(String(Math.round(bpm.value)));
    setEditing(true);
  }
  function commit() {
    const n = parseFloat(draft);
    if (Number.isFinite(n) && n >= MIN_BPM && n <= MAX_BPM) {
      setBpm({ value: n, manualOverride: true });
    }
    setEditing(false);
  }
  function cancel() {
    setEditing(false);
  }
  function onReset() {
    reset();
    setEditing(false);
  }

  const display = bpm ? `${Math.round(bpm.value)}` : "———";
  const confidence = bpm?.confidence ?? 0;
  const isManualBpm = bpm?.manualOverride ?? false;

  // Time-sig display: pick the conventional row that matches beatsPerBar.
  // If the persisted numerator doesn't appear in the picker we still show
  // it (e.g. "11/4" if some future job carries that), but the menu below
  // can't reach it.
  const matchedSig = SIGNATURES.find((s) => s.num === beatsPerBar);
  const tsDisplay = matchedSig ? matchedSig.label : `${beatsPerBar}/4`;
  const isDefaultTs = beatsPerBar === 4;

  const bpmColor = isManualBpm ? LCD_AMBER : LCD_GREEN;
  const bpmGlow = isManualBpm ? GLOW_AMBER : GLOW_GREEN;
  const tsColor = isDefaultTs ? LCD_GREEN : LCD_AMBER;
  const tsGlow = isDefaultTs ? GLOW_GREEN : GLOW_AMBER;

  // Outer plate — both LCDs sit on this single bezel.
  const bezel: React.CSSProperties = {
    background:
      "linear-gradient(180deg, #FAF6EC 0%, #E8E1D0 50%, #C9BFA6 100%)",
    boxShadow: [
      "inset 0 1px 0 rgba(255,255,255,0.85)",
      "inset 0 -1px 0 rgba(0,0,0,0.18)",
      "0 1px 2px rgba(0,0,0,0.18)",
    ].join(", "),
    borderRadius: 6,
    padding: "5px 6px",
  };

  // Engraved divider between the BPM and TS sections — a 1px dark hairline
  // with a 1px lighter shoulder on the right so the line reads as a real
  // groove, not a coloured rectangle.
  const dividerStyle: React.CSSProperties = {
    width: 2,
    background:
      "linear-gradient(90deg, rgba(0,0,0,0.18) 0 1px, rgba(255,255,255,0.7) 1px 2px)",
    alignSelf: "stretch",
    margin: "1px 2px",
    borderRadius: 1,
  };

  return (
    <div className="inline-flex items-center gap-2 self-center" style={bezel}>
      {/* ─── BPM section ─────────────────────────────────────── */}
      <div className="flex items-center gap-2">
        {/* Vertical stencil */}
        <div className="flex flex-col items-center justify-between h-7">
          <span
            aria-hidden
            className="font-display text-[8px] tracking-[0.2em] text-ink-2 leading-tight uppercase"
            style={{
              writingMode: "vertical-rl",
              transform: "rotate(180deg)",
              letterSpacing: "0.18em",
            }}
          >
            BPM
          </span>
          {isManualBpm && (
            <span
              data-testid="bpm-manual-marker"
              className="font-display text-[7px] leading-none tracking-[0.1em] text-hot uppercase"
              title="manual override — click LCD to reset"
              style={{ marginTop: 1 }}
            >
              MAN
            </span>
          )}
        </div>
        <div className="relative inline-flex items-center gap-2">
          {editing ? (
            <input
              ref={inputRef}
              data-testid="bpm-input"
              type="number"
              min={MIN_BPM}
              max={MAX_BPM}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={commit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commit();
                else if (e.key === "Escape") cancel();
              }}
              className={[
                "font-mono tabular tracking-[0.05em]",
                "text-lg px-2 rounded-[3px] w-[58px] text-right",
                "border border-black/40 outline-none focus:border-hot",
              ].join(" ")}
              style={{
                height: 28,
                lineHeight: "26px",
                paddingTop: 0,
                paddingBottom: 0,
                background: LCD_BG,
                boxShadow: LCD_SHADOW,
                color: bpmColor,
                textShadow: bpmGlow,
              }}
            />
          ) : (
            <button
              type="button"
              data-testid="bpm-readout"
              onClick={startEdit}
              className={[
                "font-mono tabular tracking-[0.05em]",
                "text-lg px-2 rounded-[3px] w-[58px]",
                "relative cursor-pointer transition",
                "border border-black/40 hover:brightness-110",
                "inline-flex items-center justify-end leading-none",
              ].join(" ")}
              style={{
                height: 28,
                background: LCD_BG,
                boxShadow: LCD_SHADOW,
                color: bpmColor,
                textShadow: bpmGlow,
              }}
              aria-label="Edit BPM"
            >
              <span data-testid="bpm-value" className="relative z-10">
                {display}
              </span>
            </button>
          )}
          {editing && detectedBpm && (
            <button
              type="button"
              data-testid="bpm-reset"
              onMouseDown={(e) => {
                e.preventDefault();
                onReset();
              }}
              onClick={onReset}
              className="font-mono text-[10px] uppercase tracking-label text-ink-3 hover:text-ink-1 underline-offset-2 hover:underline"
              aria-label="Reset to detected BPM"
            >
              ↺ {Math.round(detectedBpm.value)}
            </button>
          )}
          {bpm && !editing && <ConfidenceBar value={confidence} />}
        </div>
      </div>

      {/* ─── Engraved divider ────────────────────────────────── */}
      <div aria-hidden style={dividerStyle} />

      {/* ─── Time-signature section ──────────────────────────── */}
      <div className="relative flex items-center gap-2">
        {/* Vertical "SIG" stencil to mirror the BPM stencil. */}
        <span
          aria-hidden
          className="font-display text-[8px] tracking-[0.2em] text-ink-2 leading-tight uppercase"
          style={{
            writingMode: "vertical-rl",
            transform: "rotate(180deg)",
            letterSpacing: "0.18em",
          }}
        >
          SIG
        </span>
        <button
          ref={tsTriggerRef}
          type="button"
          data-testid="time-sig-readout"
          onClick={() => setTsOpen((v) => !v)}
          aria-haspopup="dialog"
          aria-expanded={tsOpen}
          aria-label={`Time signature ${tsDisplay} — click to change`}
          className={[
            "font-mono tabular tracking-[0.05em]",
            "text-lg px-2 rounded-[3px] w-[60px]",
            "relative cursor-pointer transition",
            "border border-black/40 hover:brightness-110",
            "inline-flex items-center justify-center leading-none",
          ].join(" ")}
          style={{
            height: 28,
            background: LCD_BG,
            boxShadow: LCD_SHADOW,
            color: tsColor,
            textShadow: tsGlow,
          }}
        >
          <span data-testid="time-sig-value" className="relative z-10">
            {tsDisplay}
          </span>
        </button>
        <HardwarePopover
          open={tsOpen}
          onClose={() => setTsOpen(false)}
          triggerRef={tsTriggerRef}
          align="center"
          ariaLabel="Choose time signature"
        >
          <TimeSigGrid
            value={beatsPerBar}
            onPick={(num) => {
              setBeatsPerBar(num);
              setTsOpen(false);
            }}
          />
        </HardwarePopover>
      </div>
    </div>
  );
}

/** Chunky-chip grid inside the brass-plate popover. Selected chip turns
 *  into a dark-LCD pill with a glowing soft-green or amber readout — the
 *  same vocabulary as the trigger LCD, so picking a value reads as
 *  "this segment lights up". */
function TimeSigGrid({
  value,
  onPick,
}: {
  value: number;
  onPick: (num: number) => void;
}) {
  return (
    <div
      data-testid="time-sig-grid"
      className="grid gap-1.5"
      style={{ gridTemplateColumns: "repeat(4, minmax(0, 1fr))" }}
    >
      {SIGNATURES.map((s) => {
        const selected = s.num === value;
        const isDefault = s.num === 4;
        const lcdColor = isDefault ? LCD_GREEN : LCD_AMBER;
        const lcdGlow = isDefault ? GLOW_GREEN : GLOW_AMBER;
        return (
          <button
            key={s.label}
            type="button"
            data-testid={`time-sig-chip-${s.label.replace("/", "-")}`}
            onClick={() => onPick(s.num)}
            aria-pressed={selected}
            className={[
              "h-9 min-w-[44px] rounded-[3px] font-mono tabular tracking-[0.05em] text-sm",
              "transition active:translate-y-[1px]",
              selected ? "" : "hover:brightness-105",
            ].join(" ")}
            style={
              selected
                ? {
                    background: LCD_BG,
                    boxShadow: LCD_SHADOW,
                    color: lcdColor,
                    textShadow: lcdGlow,
                    border: "1px solid rgba(0,0,0,0.5)",
                  }
                : {
                    background:
                      "linear-gradient(180deg, #FBF8EE 0%, #ECE3CE 100%)",
                    boxShadow: [
                      "inset 0 1px 0 rgba(255,255,255,0.9)",
                      "inset 0 -1px 0 rgba(0,0,0,0.15)",
                      "0 1px 1px rgba(0,0,0,0.15)",
                    ].join(", "),
                    color: "#1A1816",
                    border: "1px solid rgba(0,0,0,0.18)",
                  }
            }
          >
            {s.label}
          </button>
        );
      })}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="h-[14px] w-1 rounded-full overflow-hidden"
      title={`${pct}% confidence`}
      aria-label={`BPM confidence ${pct}%`}
      style={{
        background: "rgba(0,0,0,0.18)",
        boxShadow: "inset 0 1px 1px rgba(0,0,0,0.3)",
      }}
    >
      <div
        className="w-full transition-all"
        style={{
          height: `${pct}%`,
          background: "linear-gradient(180deg, #FF5722 0%, #E27D2D 100%)",
          marginTop: `${100 - pct}%`,
        }}
      />
    </div>
  );
}
