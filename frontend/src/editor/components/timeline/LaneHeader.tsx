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
  /** True while this cam is being held (TAKE pressed or hotkey down). */
  pressed?: boolean;
  /** True once the hold has crossed the paint-mode threshold. */
  painting?: boolean;
  /** Cam is in background prep (decoding / matching / extracting frames).
   *  Surfaces as a pulsing "PREP" badge; the TAKE button still works
   *  because the cam can already be cut to (the video plays even
   *  before the matcher finishes). */
  preparing?: boolean;
  onSelectClip?: () => void;
  /** Tap → quick cut. Hold gestures fire onTakeStart/Finish in addition. */
  onTake?: () => void;
  /** Pointer pressed down on TAKE — record the press start time externally. */
  onTakeStart?: () => void;
  /** Pointer released on TAKE — overwrite from press-start to release. */
  onTakeFinish?: () => void;
  /** True when this cam has been nudged off its primary algorithm
   *  alignment (override / drag / alternate candidate selected). When
   *  true a small ↺ button appears so the user can revert. */
  canReset?: boolean;
  /** Reset this cam to the primary candidate, no override, no startOffset. */
  onReset?: () => void;
  /** Optional delete handler. When provided, a small × button shows on
   *  hover. Prompts via window.confirm before firing. */
  onDelete?: () => void;
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
  pressed = false,
  painting = false,
  preparing = false,
  onSelectClip,
  onTake,
  onTakeStart,
  onTakeFinish,
  canReset = false,
  onReset,
  onDelete,
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

  // The header packs into a half-height row (48 px by default). Layout:
  //
  //   ┌─┬───────────────────────────────┬────────┐
  //   │ │ ● CAM 1                    ↺  │   ¹    │
  //   │■│ try2handy.mp4 …               │  TAKE  │
  //   └─┴───────────────────────────────┴────────┘
  //
  // - Left: cam-colour edge stripe (full height).
  // - Top text row: tally dot + cam name. Status is encoded by the dot
  //   colour alone (no "ON AIR" / "READY" text).
  // - Bottom text row: filename, full inner width, single line truncated.
  // - Reset (↺) tucks into the top-right of the labels area.
  // - Right: TAKE button with the keyboard-shortcut number as a small
  //   superscript badge in its top-right corner — replaces the standalone
  //   hotkey "1" badge that used to look like a clickable button.
  const TAKE_W = 44;
  const TAKE_H = Math.max(28, height - 8);
  const tallyColor =
    status === "on-air"
      ? "#FF3326"
      : status === "available"
        ? "#3F8F5A"
        : "#9A8F80";
  const tallyShadow =
    status === "on-air" ? "0 0 4px rgba(255,51,38,0.55)" : "inset 0 0 0 0.5px rgba(0,0,0,0.15)";
  return (
    <div
      className="group relative shrink-0 select-none flex items-stretch overflow-hidden border-r border-b border-rule cursor-pointer bg-paper-hi hover:bg-paper transition-colors"
      style={{
        width: HEADER_W,
        height,
        boxShadow: selected ? `inset 3px 0 0 ${color}` : undefined,
      }}
      onClick={onSelectClip}
    >
      {/* Delete affordance — pinned to the top-left corner of the
       *  whole header (over the cam-color stripe edge), styled like
       *  the transport's secondary ChunkyButton: paper-hi face,
       *  embossed shadow, ink text. Always-visible so the affordance
       *  is discoverable without hover. Click → window.confirm
       *  before firing. */}
      {onDelete && (
        <button
          type="button"
          aria-label={`Remove ${name}`}
          title={`Remove ${name}`}
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Remove ${name} from this project?`)) {
              onDelete();
            }
          }}
          className="absolute top-0 left-0 z-20 w-[14px] h-[14px] flex items-center justify-center rounded-br-md border-r border-b border-rule/60 bg-hot text-paper-hi shadow-emboss hover:bg-hot-pressed active:shadow-pressed font-mono text-[10px] leading-none opacity-0 group-hover:opacity-100 transition-opacity"
        >
          ×
        </button>
      )}
      {/* Cam-color edge stripe — full-height solid bar. */}
      <div className="w-[5px] shrink-0" style={{ background: color }} />

      {/* Module body */}
      <div className="flex-1 relative px-2 py-1.5 flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0 flex flex-col gap-0.5 pr-1">
          {/* Top row: tally dot + cam name + reset action. */}
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              aria-hidden
              className="block w-[6px] h-[6px] rounded-full shrink-0"
              style={{
                background: tallyColor,
                boxShadow: tallyShadow,
                opacity: status === "off" ? 0.45 : 1,
              }}
              title={
                status === "on-air"
                  ? "On air"
                  : status === "available"
                    ? "Ready"
                    : "Off"
              }
            />
            <span className="font-display font-semibold text-[11px] tracking-label uppercase text-ink leading-none truncate">
              {name}
            </span>
            {canReset && onReset && (
              <button
                type="button"
                aria-label="Reset alignment to detected"
                title="Reset alignment to detected"
                onClick={(e) => {
                  e.stopPropagation();
                  onReset();
                }}
                className="ml-auto shrink-0 w-4 h-4 flex items-center justify-center font-mono text-[12px] leading-none text-ink-3 hover:text-hot transition-colors"
              >
                ↺
              </button>
            )}
          </div>
          {/* Bottom row: filename, takes the full inner width so longer
           * names actually fit before truncation kicks in. */}
          <span
            className="font-mono text-[9px] text-ink-3 leading-snug truncate min-w-0"
            title={filename}
          >
            {filename}
          </span>
          {preparing && (
            <span
              className="inline-flex items-center gap-1 font-display tracking-label uppercase text-[8.5px] text-hot mt-0.5"
              role="status"
              aria-live="polite"
            >
              <span
                aria-hidden
                className="inline-block w-[5px] h-[5px] rounded-full bg-hot animate-pulse"
                style={{ boxShadow: "0 0 4px rgba(255,87,34,0.85)" }}
              />
              prep
            </span>
          )}
        </div>

        {/* TAKE button — slimmer, with the keyboard-hotkey number as a
         * small superscript badge in the top-right so the user knows
         * which key fires this button. The badge is purely decorative
         * (the global keydown handler in Editor.tsx does the dispatch). */}
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          aria-label={
            hotkeyLabel
              ? `Take ${name} — keyboard shortcut ${hotkeyLabel} (hold to overwrite range)`
              : `Take ${name} (hold to overwrite range)`
          }
          className="relative shrink-0 transition-transform"
          style={{
            width: TAKE_W,
            height: TAKE_H,
            transform: pressed ? "translateY(2px)" : undefined,
          }}
        >
          <span
            className="absolute inset-0 rounded-md flex items-center justify-center"
            style={takeFace(status === "on-air", pressed, painting, color)}
          >
            <span
              className="font-display font-semibold text-[10px] tracking-label uppercase leading-none"
              style={{
                color: painting
                  ? "#FFF"
                  : status === "on-air"
                    ? "#FF3326"
                    : "#1A1816",
                textShadow: painting
                  ? "0 1px 1px rgba(0,0,0,0.45)"
                  : status === "on-air"
                    ? "0 0 4px rgba(255,51,38,0.35)"
                    : "0 1px 0 rgba(255,255,255,0.4)",
                transition: "color 120ms ease",
              }}
            >
              {painting ? "REC" : "TAKE"}
            </span>
          </span>
          {hotkeyLabel && (
            <span
              aria-hidden
              className="absolute font-mono leading-none pointer-events-none"
              style={{
                top: 2,
                right: 3,
                fontSize: 8,
                color: "rgba(26,24,22,0.55)",
                fontWeight: 600,
                letterSpacing: "0.04em",
              }}
            >
              {hotkeyLabel}
            </span>
          )}
        </button>
      </div>
    </div>
  );
}

LaneHeader.WIDTH = HEADER_W;

/**
 * Recessed paper-toned button face.
 *   - Resting: subtle inset rule.
 *   - ON AIR: inset cam-red stroke around the perimeter.
 *   - Pressed (hold start): button face goes pressed-shadow.
 *   - Painting (hold > 500 ms): face fills with cam color, "REC" pulses
 *     above. The cam color creeping out of the recessed face mirrors the
 *     live cam-color paint creeping across the PROGRAM strip — same
 *     gesture, two visual cues.
 */
function takeFace(
  onAir: boolean,
  pressed: boolean,
  painting: boolean,
  color: string,
): CSSProperties {
  if (painting) {
    return {
      background: `linear-gradient(180deg, ${color} 0%, ${color}cc 100%)`,
      boxShadow:
        "inset 0 0 0 1.5px rgba(255,255,255,0.45), inset 0 2px 3px rgba(0,0,0,0.35), 0 0 8px rgba(255,51,38,0.55)",
      animation: "vas-rec-pulse 1.1s ease-in-out infinite",
    };
  }
  if (pressed) {
    return {
      background: "linear-gradient(180deg, #E2D9C0 0%, #D5CAA8 100%)",
      boxShadow:
        "inset 0 2px 3px rgba(0,0,0,0.22), inset 0 -1px 0 rgba(255,255,255,0.25), 0 0 0 1.5px rgba(0,0,0,0.15)",
    };
  }
  return {
    background: "linear-gradient(180deg, #FAF6EC 0%, #EFE7D2 100%)",
    boxShadow: onAir
      ? "inset 0 0 0 1.5px #FF3326, inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06)"
      : "inset 0 0 0 1px rgba(154,143,128,0.55), inset 0 1px 0 rgba(255,255,255,0.65), inset 0 -1px 0 rgba(0,0,0,0.10), 0 1px 1px rgba(0,0,0,0.06)",
  };
}
