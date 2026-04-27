/**
 * Lane-Header: hardware control strip on the left of each video lane.
 *
 * Inspired by vintage TV-switcher tally panels and Eurorack modules:
 *  - vertical cam-color stripe (continuity with the PROGRAM strip)
 *  - tiny corner "screw" for skeuomorphism
 *  - cam name + filename + hotkey chip
 *  - round TAKE button (rubber surface, cam-colored, with LED tally ring)
 *
 * The TAKE button doesn't fire in V1 of Schritt 6 — Schritt 8 wires it up
 * to the cuts list. Visually it already shows status (dim/available/on-air).
 */
import { CSSProperties, MouseEvent } from "react";

export type CamStatus = "off" | "available" | "on-air";

interface Props {
  name: string;
  filename: string;
  color: string;
  status: CamStatus;
  /** "1".."9" for the keyboard shortcut, undefined for cam 10+. */
  hotkeyLabel?: string;
  selected?: boolean;
  onSelectClip?: () => void;
  onTake?: () => void;
  height?: number;
}

const HEADER_W = 132;

export function LaneHeader({
  name,
  filename,
  color,
  status,
  hotkeyLabel,
  selected = false,
  onSelectClip,
  onTake,
  height = 80,
}: Props) {
  const ledColor =
    status === "on-air" ? "#FF3326" : status === "available" ? "#34D399" : "#3A352E";
  const ledGlow =
    status === "on-air"
      ? `0 0 14px ${ledColor}, 0 0 5px ${ledColor}`
      : status === "available"
        ? `0 0 6px ${ledColor}`
        : "none";
  const ledOpacity = status === "off" ? 0.18 : 1;

  const handleTake = (e: MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onTake?.();
  };

  const moduleStyle: CSSProperties = {
    background: `
      radial-gradient(ellipse 80% 60% at 50% 0%, rgba(255,255,255,0.45) 0%, transparent 70%),
      linear-gradient(180deg, #DDD4BE 0%, #C9BFA6 100%)
    `,
  };

  const buttonCoreStyle: CSSProperties = {
    background: `
      radial-gradient(circle at 32% 26%, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0) 55%),
      radial-gradient(circle at 50% 50%, ${color} 0%, ${color} 60%, ${darken(color, 0.18)} 100%)
    `,
    boxShadow:
      "inset 0 2px 2px rgba(255,255,255,0.45), inset 0 -2px 3px rgba(0,0,0,0.32), 0 2px 3px rgba(0,0,0,0.22)",
  };

  return (
    <div
      className="relative shrink-0 select-none flex items-stretch overflow-hidden border-r border-b border-rule cursor-pointer"
      style={{
        width: HEADER_W,
        height,
        boxShadow: selected
          ? `inset 0 0 0 2px ${color}, inset 0 0 0 4px rgba(255,255,255,0.6)`
          : undefined,
      }}
      onClick={onSelectClip}
    >
      {/* Vertical color stripe — visual continuity with PROGRAM-strip segments */}
      <div
        className="w-[6px] shrink-0"
        style={{
          background: `linear-gradient(180deg, ${color} 0%, ${darken(color, 0.18)} 100%)`,
          boxShadow: "inset -1px 0 0 rgba(0,0,0,0.22)",
        }}
      />

      {/* Module body */}
      <div
        className="flex-1 relative px-2 py-2 flex items-center gap-2"
        style={moduleStyle}
      >
        {/* Two tiny "screws" — top-right and bottom-right — for skeuomorphism. */}
        <Screw className="absolute top-1.5 right-1.5" />
        <Screw className="absolute bottom-1.5 right-1.5" />

        {/* Labels */}
        <div className="flex-1 min-w-0 flex flex-col gap-1 pr-1">
          <div className="flex items-baseline gap-1.5">
            <span className="font-display font-semibold text-[11px] tracking-label uppercase text-ink leading-none">
              {name}
            </span>
            {hotkeyLabel && (
              <span
                className="font-mono text-[9px] tracking-label text-ink leading-none rounded-sm border border-rule/70 bg-paper-hi px-[3px] py-[2px]"
                style={{ boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.06), 0 1px 0 rgba(255,255,255,0.5)" }}
              >
                {hotkeyLabel}
              </span>
            )}
          </div>
          <span className="font-mono text-[9px] text-ink-3 leading-none truncate" title={filename}>
            {filename}
          </span>
          {status === "on-air" && (
            <span
              className="font-mono text-[8px] tracking-label uppercase leading-none mt-0.5"
              style={{ color: ledColor, textShadow: `0 0 4px ${ledColor}` }}
            >
              ● ON AIR
            </span>
          )}
        </div>

        {/* TAKE button */}
        <button
          type="button"
          onClick={handleTake}
          aria-label={`Take ${name}`}
          className="relative w-[44px] h-[44px] shrink-0 transition-transform active:translate-y-px active:scale-[0.97]"
        >
          {/* LED tally ring (outer halo) */}
          <span
            className="absolute -inset-[3px] rounded-full pointer-events-none"
            style={{
              background: ledColor,
              boxShadow: ledGlow,
              opacity: ledOpacity,
              transition: "box-shadow 120ms ease-out, opacity 120ms ease-out, background 120ms ease-out",
            }}
          />
          {/* Button core */}
          <span
            className="absolute inset-0 rounded-full flex items-center justify-center"
            style={buttonCoreStyle}
          >
            <span
              className="font-display font-semibold text-[10px] tracking-label uppercase text-paper-hi leading-none"
              style={{ textShadow: "0 1px 1px rgba(0,0,0,0.4)" }}
            >
              TAKE
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

LaneHeader.WIDTH = HEADER_W;

function Screw({ className = "" }: { className?: string }) {
  return (
    <span
      className={`block w-[5px] h-[5px] rounded-full pointer-events-none ${className}`}
      style={{
        background: "radial-gradient(circle at 30% 30%, #9A8F80 0%, #4B433A 100%)",
        boxShadow:
          "inset 0 -0.5px 0 rgba(255,255,255,0.4), 0 0.5px 0 rgba(255,255,255,0.5)",
      }}
    />
  );
}

/** Darken a hex color by a fraction. */
function darken(hex: string, fraction: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return hex;
  const r = Math.round(parseInt(c.slice(0, 2), 16) * (1 - fraction));
  const g = Math.round(parseInt(c.slice(2, 4), 16) * (1 - fraction));
  const b = Math.round(parseInt(c.slice(4, 6), 16) * (1 - fraction));
  return `#${[r, g, b].map((n) => Math.max(0, n).toString(16).padStart(2, "0")).join("")}`;
}
