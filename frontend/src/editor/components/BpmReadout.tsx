/**
 * BPM segment-LCD with click-to-edit override.
 *
 * Reads the active tempo from the editor store and renders it in a
 * skeuomorphic dark-sunken display. Clicking opens a small numeric input
 * (Enter = commit, Esc = cancel). A "★" marker indicates a manual
 * override; the "RESET" button reverts to the auto-detected value.
 */
import { useState, useRef, useEffect } from "react";
import { useEditorStore } from "../store";

const MIN_BPM = 30;
const MAX_BPM = 240;

export function BpmReadout() {
  const bpm = useEditorStore((s) => s.jobMeta?.bpm);
  const detectedBpm = useEditorStore((s) => s.jobMeta?.detectedBpm);
  const setBpm = useEditorStore((s) => s.setBpm);
  const reset = useEditorStore((s) => s.resetBpmToDetected);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

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
  const isManual = bpm?.manualOverride ?? false;

  // CSS for the LCD: dark sunken panel, faint horizontal scanline pattern,
  // subtle pixel-grid overlay. The text colour drifts slightly green when
  // the value is detected (electric LCD look) and amber when the user has
  // overridden it (so the override is visually unmistakable).
  const lcdBg = `
    repeating-linear-gradient(0deg, rgba(255,255,255,0.04) 0 1px, transparent 1px 3px),
    repeating-linear-gradient(90deg, rgba(0,0,0,0.10) 0 1px, transparent 1px 3px),
    radial-gradient(120% 80% at 50% 0%, rgba(255,255,255,0.06), rgba(0,0,0,0) 60%),
    linear-gradient(180deg, #0E1311 0%, #0A0E0C 100%)
  `;
  const lcdShadow = [
    "inset 0 1px 0 rgba(255,255,255,0.05)",
    "inset 0 -1px 0 rgba(0,0,0,0.5)",
    "inset 0 0 18px rgba(0,0,0,0.55)",
    "0 1px 0 rgba(255,255,255,0.5)",
  ].join(", ");
  const lcdColor = isManual ? "#FFB347" : "#9DEFD0"; // amber vs. soft LCD-green
  const lcdGlow = isManual
    ? "0 0 6px rgba(255,179,71,0.55), 0 0 1px rgba(255,179,71,0.9)"
    : "0 0 5px rgba(157,239,208,0.4), 0 0 1px rgba(157,239,208,0.8)";

  // Same chrome look as the cassette plate so the LCD reads as "part of
  // the same hardware" — a light bezel framing a dark sunken display.
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

  return (
    <div className="inline-flex items-center gap-2 self-center" style={bezel}>
      {/* Vertical "BPM" stencil on the bezel — sits to the left of the
          glass like a Roland tempo display. A small "MAN" badge appears
          below it when the user has manually overridden the detection. */}
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
        {isManual && (
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
              "text-lg px-2.5 py-1 rounded-[3px] w-[72px] text-right",
              "border border-black/40 outline-none focus:border-hot",
            ].join(" ")}
            style={{
              background: lcdBg,
              boxShadow: lcdShadow,
              color: lcdColor,
              textShadow: lcdGlow,
            }}
          />
        ) : (
          <button
            type="button"
            data-testid="bpm-readout"
            onClick={startEdit}
            className={[
              "font-mono tabular tracking-[0.05em]",
              "text-lg px-2.5 py-1 rounded-[3px] w-[72px] text-right",
              "relative cursor-pointer transition",
              "border border-black/40 hover:brightness-110",
            ].join(" ")}
            style={{
              height: 28,
              background: lcdBg,
              boxShadow: lcdShadow,
              color: lcdColor,
              textShadow: lcdGlow,
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
            // mousedown fires BEFORE the input's blur. preventDefault here
            // stops the click from shifting focus → blur → commit-the-draft
            // → unmount-this-button race that swallowed the reset action.
            // We do the reset on mousedown directly so the click handler
            // doesn't even need to fire. onClick is kept as a fallback so
            // the button works under keyboard activation and synthetic
            // test clicks (which only fire `click`, not `mousedown`).
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
        {/* Tiny confidence bar tucked under the LCD inside the bezel —
            keeps the readout one row tall and aligned with the buttons. */}
        {bpm && !editing && (
          <ConfidenceBar value={confidence} />
        )}
      </div>
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
