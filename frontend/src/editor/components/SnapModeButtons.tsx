/**
 * Cassette-recorder style mode-selector for the timeline:
 *   OFF · MATCH · 1 · 1/2 · 1/4 · 1/8 · 1/16    [gap]    🔒
 *
 * Mutually exclusive — clicking one button activates that mode and
 * deactivates the others. The `LOCK` toggle is independent and disables
 * cam-clip horizontal drag so the playhead stays draggable through dense
 * timelines.
 *
 * Grid modes (1, 1/2, 1/4, 1/8, 1/16) are disabled when no BPM has been
 * detected — they have nothing to snap to. OFF and MATCH stay available.
 */
import { useEditorStore } from "../store";
import type { SnapMode } from "../snap";
import { isVideoClip } from "../types";

const MODE_BUTTONS: { mode: SnapMode; label: string; needsBpm: boolean }[] = [
  { mode: "off", label: "OFF", needsBpm: false },
  { mode: "match", label: "MATCH", needsBpm: false },
  { mode: "1", label: "1", needsBpm: true },
  { mode: "1/2", label: "1/2", needsBpm: true },
  { mode: "1/4", label: "1/4", needsBpm: true },
  { mode: "1/8", label: "1/8", needsBpm: true },
  { mode: "1/16", label: "1/16", needsBpm: true },
];

// Cassette-deck button styling — light cream housing (matches the rest
// of the paper-toned chrome) with dark sunken key-caps and ivory engraved
// labels. Visually a tape-deck transport: brushed cream plate, the keys
// sit in it like dark hard-rubber buttons. Active key glows via the
// status LED above it.
const PLATE_STYLE: React.CSSProperties = {
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

const KEY_REST: React.CSSProperties = {
  background:
    "linear-gradient(180deg, #2A2520 0%, #1A1612 60%, #2A2520 100%)",
  boxShadow: [
    "inset 0 1px 0 rgba(255,255,255,0.10)",
    "inset 0 -1px 0 rgba(0,0,0,0.6)",
    "0 2px 0 rgba(0,0,0,0.45)",
    "0 3px 4px rgba(0,0,0,0.35)",
  ].join(", "),
  color: "#FAF6EC",
};

const KEY_ACTIVE: React.CSSProperties = {
  background:
    "linear-gradient(180deg, #0E0B08 0%, #1A1612 100%)",
  boxShadow: [
    "inset 0 1px 2px rgba(0,0,0,0.7)",
    "inset 0 -1px 0 rgba(255,255,255,0.06)",
    "0 1px 0 rgba(255,255,255,0.15)",
  ].join(", "),
  color: "#FAF6EC",
  transform: "translateY(2px)",
};

const KEY_BASE_CLS = [
  "relative",
  "h-7 min-w-[30px] px-2 text-[10px] font-display tracking-label",
  "rounded-[3px] border border-black/40",
  "select-none transition-transform duration-75",
  "disabled:opacity-25 disabled:cursor-not-allowed",
  "flex items-center justify-center gap-1",
].join(" ");

interface KeyProps {
  active: boolean;
  disabled?: boolean;
  testId?: string;
  title?: string;
  ariaLabel?: string;
  onClick: () => void;
  children: React.ReactNode;
}

function CassetteKey({
  active,
  disabled,
  testId,
  title,
  ariaLabel,
  onClick,
  children,
}: KeyProps) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-pressed={active}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={onClick}
      className={KEY_BASE_CLS}
      style={active ? KEY_ACTIVE : KEY_REST}
      title={title}
    >
      {/* Tally LED — small filled dot above the label, glows red when
          this key is the active mode. Dim grey when idle. */}
      <span
        aria-hidden
        className="absolute top-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full"
        style={{
          background: active ? "#FF5722" : "rgba(255,255,255,0.18)",
          boxShadow: active
            ? "0 0 4px rgba(255,87,34,0.9), 0 0 1px rgba(255,87,34,0.6)"
            : "inset 0 1px 1px rgba(0,0,0,0.4)",
        }}
      />
      <span className="leading-none mt-1">{children}</span>
    </button>
  );
}

export function SnapModeButtons() {
  const snapMode = useEditorStore((s) => s.ui.snapMode);
  const lanesLocked = useEditorStore((s) => s.ui.lanesLocked);
  const setSnapMode = useEditorStore((s) => s.setSnapMode);
  const setLanesLocked = useEditorStore((s) => s.setLanesLocked);
  const hasBpm = useEditorStore((s) => Boolean(s.jobMeta?.bpm));
  // MATCH only makes sense for clips with audio-match candidates. When a
  // B-roll cam (no candidates) is selected, the button greys out — the
  // store also auto-downgrades the mode if it happens to be MATCH at that
  // moment, but disabling here keeps the UI honest about availability.
  const matchAvailable = useEditorStore((s) => {
    if (s.selectedClipId === null) return true;
    const clip = s.clips.find((c) => c.id === s.selectedClipId);
    if (!clip) return true;
    // Image clips never have audio match candidates.
    if (!isVideoClip(clip)) return false;
    return clip.candidates.length > 0;
  });

  return (
    <div
      className="inline-flex items-center gap-1.5 self-center"
      style={PLATE_STYLE}
      role="group"
      aria-label="Snap mode"
    >
      {MODE_BUTTONS.map(({ mode, label, needsBpm }) => {
        const active = snapMode === mode;
        const disabled =
          (needsBpm && !hasBpm) || (mode === "match" && !matchAvailable);
        return (
          <CassetteKey
            key={mode}
            active={active}
            disabled={disabled}
            testId={`snap-mode-${mode}`}
            title={
              mode === "match" && !matchAvailable
                ? "Match: this cam has no audio-match candidates"
                : `Snap: ${label}`
            }
            onClick={() => setSnapMode(mode)}
          >
            {label}
          </CassetteKey>
        );
      })}
      {/* Vertical separator — visually offsets the LOCK key from the
          snap-mode group so it reads as its own transport function. */}
      <span
        aria-hidden
        className="self-stretch w-px mx-1"
        style={{ background: "rgba(0,0,0,0.18)" }}
      />
      <CassetteKey
        active={!lanesLocked}
        testId="snap-lock"
        title={
          lanesLocked
            ? "Lanes locked — press to unlock and drag clips"
            : "Lanes unlocked — click again to lock"
        }
        ariaLabel={lanesLocked ? "Unlock lanes" : "Lock lanes"}
        onClick={() => setLanesLocked(!lanesLocked)}
      >
        {lanesLocked ? "🔒" : "🔓"}
      </CassetteKey>
    </div>
  );
}
