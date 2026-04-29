/**
 * Left-header cell for the bar-ruler row. Hosts the "BARS" stencil plus
 * a tiny pickup LED — clickable to set the anacrusis (= number of beats
 * before bar 1). Visual vocabulary mirrors the BpmReadout: brass bezel,
 * inset LCD, soft-green when default and amber when the user shifted
 * the value.
 */
import { useRef, useState } from "react";
import { useEditorStore } from "../../store";
import {
  effectiveBeatsPerBar,
  effectiveBarOffsetBeats,
} from "../../selectors/timing";
import { HardwarePopover } from "../HardwarePopover";

interface BarsHeaderProps {
  /** Cell width (px). Should match the global HEADER_W in Timeline.tsx. */
  width: number;
  /** Cell height (px). Matches the ruler-row height (typically 26). */
  height: number;
}

const LCD_BG = `
  repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px),
  repeating-linear-gradient(90deg, rgba(0,0,0,0.10) 0 1px, transparent 1px 3px),
  radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.06), rgba(0,0,0,0) 60%),
  linear-gradient(180deg, #0E1311 0%, #0A0E0C 100%)
`;
const LCD_SHADOW = [
  "inset 0 1px 0 rgba(255,255,255,0.05)",
  "inset 0 -1px 0 rgba(0,0,0,0.5)",
  "inset 0 0 14px rgba(0,0,0,0.55)",
  "0 1px 0 rgba(255,255,255,0.45)",
].join(", ");
const LCD_GREEN = "#9DEFD0";
const LCD_AMBER = "#FFB347";
const GLOW_GREEN =
  "0 0 4px rgba(157,239,208,0.45), 0 0 1px rgba(157,239,208,0.85)";
const GLOW_AMBER =
  "0 0 5px rgba(255,179,71,0.6), 0 0 1px rgba(255,179,71,0.95)";

export function BarsHeader({ width, height }: BarsHeaderProps) {
  const beatsPerBar = useEditorStore((s) => effectiveBeatsPerBar(s.jobMeta));
  const pickup = useEditorStore((s) => effectiveBarOffsetBeats(s.jobMeta));
  const setBarOffsetBeats = useEditorStore((s) => s.setBarOffsetBeats);
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const isDefault = pickup === 0;
  const lcdColor = isDefault ? LCD_GREEN : LCD_AMBER;
  const lcdGlow = isDefault ? GLOW_GREEN : GLOW_AMBER;

  return (
    <div
      className="shrink-0 flex items-center justify-start gap-1.5 pl-3 pr-2 border-r border-rule bg-paper-hi relative"
      style={{ width, height }}
    >
      <button
        ref={triggerRef}
        type="button"
        data-testid="pickup-readout"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Pickup ${pickup} beats — click to change`}
        title="Anacrusis / pickup beats — number of beats before bar 1"
        className={[
          "font-mono tabular tracking-[0.04em]",
          "text-[10px] leading-none rounded-[2px]",
          "flex items-center gap-1 px-1.5",
          "cursor-pointer transition border border-black/40",
          "hover:brightness-110",
        ].join(" ")}
        style={{
          height: 16,
          minWidth: 32,
          background: LCD_BG,
          boxShadow: LCD_SHADOW,
          color: lcdColor,
          textShadow: lcdGlow,
        }}
      >
        <span
          aria-hidden
          className="text-[8px] tracking-[0.18em] uppercase opacity-80"
          style={{ letterSpacing: "0.18em" }}
        >
          P
        </span>
        <span data-testid="pickup-value" className="tabular">
          {pickup}
        </span>
      </button>
      <HardwarePopover
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        align="left"
        ariaLabel="Choose pickup beats"
      >
        <PickupGrid
          value={pickup}
          beatsPerBar={beatsPerBar}
          onPick={(n) => {
            setBarOffsetBeats(n);
            setOpen(false);
          }}
        />
      </HardwarePopover>
    </div>
  );
}

function PickupGrid({
  value,
  beatsPerBar,
  onPick,
}: {
  value: number;
  beatsPerBar: number;
  onPick: (n: number) => void;
}) {
  const choices = Array.from({ length: beatsPerBar }, (_, i) => i);
  // Cap the column count so 12/8 still wraps cleanly. 6 columns gives a
  // 6 × 2 grid for 12/8, 4 × 1 for 4/4, 3 × 1 for 3/4.
  const cols = Math.min(6, beatsPerBar);
  return (
    <div className="flex flex-col gap-1.5" style={{ minWidth: 220 }}>
      <div className="flex items-baseline justify-between px-0.5">
        <span className="font-display text-[9px] tracking-[0.18em] uppercase text-ink-2">
          Pickup
        </span>
        <span className="font-mono text-[9px] text-ink-3">
          beats before bar 1
        </span>
      </div>
      <div
        data-testid="pickup-grid"
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {choices.map((n) => {
          const selected = n === value;
          const isZero = n === 0;
          const lcdColor = isZero ? LCD_GREEN : LCD_AMBER;
          const lcdGlow = isZero ? GLOW_GREEN : GLOW_AMBER;
          return (
            <button
              key={n}
              type="button"
              data-testid={`pickup-chip-${n}`}
              onClick={() => onPick(n)}
              aria-pressed={selected}
              className={[
                "h-9 min-w-[36px] rounded-[3px] font-mono tabular text-sm",
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
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
