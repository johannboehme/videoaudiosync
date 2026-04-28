/**
 * Lane-Header: hardware control strip on the left of each video lane.
 *
 * Vintage-tally aesthetic — sepia/paper tones for the body, cam color
 * reduced to a left-edge stripe + a small tally LED. The TAKE button
 * itself is a recessed paper-toned hardware button (no candy gradients,
 * no halo glow). Status is communicated by the small TALLY LED, not by
 * tinting the button.
 *
 * Sized to fit a 44 × 44 button + name/filename column without clipping.
 */
import { CSSProperties, PointerEvent as ReactPointerEvent } from "react";

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
  /** Tap → quick cut. Hold gestures fire onTakeStart/Finish in addition. */
  onTake?: () => void;
  /** Pointer pressed down on TAKE — record the press start time externally. */
  onTakeStart?: () => void;
  /** Pointer released on TAKE — overwrite from press-start to release. */
  onTakeFinish?: () => void;
  height?: number;
}

const HEADER_W = 156;

export function LaneHeader({
  name,
  filename,
  color,
  status,
  hotkeyLabel,
  selected = false,
  onSelectClip,
  onTake,
  onTakeStart,
  onTakeFinish,
  height = 80,
}: Props) {
  const handlePointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    // Tap = onTake (insert the cut at press time). Hold release later
    // calls onTakeFinish to apply the overwrite-range.
    onTake?.();
    onTakeStart?.();
  };
  const handlePointerUp = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onTakeFinish?.();
  };
  const handlePointerCancel = (e: ReactPointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    onTakeFinish?.();
  };

  return (
    <div
      className="relative shrink-0 select-none flex items-stretch overflow-hidden border-r border-b border-rule cursor-pointer bg-paper-hi hover:bg-paper transition-colors"
      style={{
        width: HEADER_W,
        height,
        boxShadow: selected
          ? `inset 3px 0 0 ${color}`
          : undefined,
      }}
      onClick={onSelectClip}
    >
      {/* Cam-color edge stripe — single solid bar, no gradient, no glow. */}
      <div
        className="w-[5px] shrink-0"
        style={{ background: color }}
      />

      {/* Module body — flat paper-hi, no fake metal. */}
      <div className="flex-1 relative px-2.5 py-2 flex items-center gap-2 min-w-0">
        {/* Labels */}
        <div className="flex-1 min-w-0 flex flex-col gap-1 pr-1">
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span className="font-display font-semibold text-[11px] tracking-label uppercase text-ink leading-none truncate">
              {name}
            </span>
            {hotkeyLabel && (
              <span
                className="font-mono text-[9px] tracking-label text-ink-2 leading-none rounded-sm border border-rule bg-paper px-[3px] py-[1px] shrink-0"
                style={{ boxShadow: "inset 0 -1px 0 rgba(0,0,0,0.04)" }}
              >
                {hotkeyLabel}
              </span>
            )}
          </div>
          <span
            className="font-mono text-[9px] text-ink-3 leading-snug truncate min-w-0"
            title={filename}
          >
            {filename}
          </span>
          <Tally status={status} color={color} />
        </div>

        {/* TAKE button — vintage hardware look. Paper body with subtle inset
         * border + emboss shadow. Cam color shows ONLY in the tally dot, not
         * in the button face — keeps multi-cam panels from screaming. */}
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label={`Take ${name} (hold to overwrite range)`}
          className="relative shrink-0 transition-transform active:translate-y-px"
          style={{
            width: 48,
            height: 44,
          }}
        >
          <span
            className="absolute inset-0 rounded-md flex items-center justify-center"
            style={takeFace(status === "on-air")}
          >
            <span
              className="font-display font-semibold text-[10px] tracking-label uppercase leading-none"
              style={{
                color: status === "on-air" ? "#FF3326" : "#1A1816",
                textShadow:
                  status === "on-air"
                    ? "0 0 4px rgba(255,51,38,0.35)"
                    : "0 1px 0 rgba(255,255,255,0.4)",
              }}
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

/**
 * Inline tally indicator: a small LED + status word. Sits on the third
 * line of the label column so the column reads name / filename / status.
 * No haloed pulsing — just a small lit dot, like the tally on a vintage
 * studio panel.
 */
function Tally({ status, color }: { status: CamStatus; color: string }) {
  const dotColor =
    status === "on-air" ? "#FF3326" : status === "available" ? "#3F8F5A" : "#9A8F80";
  const label = status === "on-air" ? "ON AIR" : status === "available" ? "READY" : "—";
  const labelColor =
    status === "on-air"
      ? "#C42E20"
      : status === "available"
        ? "#3F8F5A"
        : "#9A8F80";
  return (
    <span className="inline-flex items-center gap-1.5 mt-0.5" aria-hidden>
      <span
        className="block w-[6px] h-[6px] rounded-full shrink-0"
        style={{
          background: dotColor,
          boxShadow:
            status === "on-air"
              ? "0 0 4px rgba(255,51,38,0.55)"
              : status === "available"
                ? "inset 0 0 0 0.5px rgba(0,0,0,0.15)"
                : "inset 0 0 0 0.5px rgba(0,0,0,0.15)",
          opacity: status === "off" ? 0.45 : 1,
        }}
      />
      <span
        className="font-mono text-[8px] tracking-label uppercase leading-none"
        style={{ color: labelColor }}
      >
        {label}
      </span>
      {/* Cam color reference — tiny stripe so the tally row is colour-tagged
        * even when status is the same across cams. */}
      <span
        className="block w-[14px] h-[2px] rounded-sm"
        style={{ background: color, opacity: 0.6 }}
      />
    </span>
  );
}

/**
 * Recessed paper-toned button face. When ON AIR, an inset cam-color stroke
 * lights up around the perimeter — much subtler than the previous halo.
 */
function takeFace(onAir: boolean): CSSProperties {
  return {
    background:
      "linear-gradient(180deg, #FAF6EC 0%, #EFE7D2 100%)",
    boxShadow: onAir
      ? "inset 0 0 0 1.5px #FF3326, inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06)"
      : "inset 0 0 0 1px rgba(154,143,128,0.55), inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06)",
  };
}
