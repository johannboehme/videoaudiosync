// Resolution control for the advanced drawer. Five chips for common targets
// + a "Custom" entry that reveals two number inputs and an aspect-lock toggle.
//
// The picker is aspect-aware: when the lock is on, editing one dimension
// scales the other to preserve the source aspect. This keeps the user out
// of the trap of producing a stretched export.

import { useEffect, useMemo, useState } from "react";

type Preset = "source" | "2160" | "1440" | "1080" | "720" | "480";

interface Props {
  source: { w: number; h: number };
  value: { w: number; h: number };
  onChange: (dims: { w: number; h: number }) => void;
}

const PRESETS: { value: Preset; label: string }[] = [
  { value: "source", label: "SRC" },
  { value: "2160", label: "4K" },
  { value: "1440", label: "1440" },
  { value: "1080", label: "1080" },
  { value: "720", label: "720" },
  { value: "480", label: "480" },
];

function presetToDims(preset: Preset, source: { w: number; h: number }) {
  if (preset === "source") return { w: source.w, h: source.h };
  const longSide = parseInt(preset, 10);
  const sourceLong = Math.max(source.w, source.h);
  if (sourceLong <= longSide) {
    // Source already fits — pass-through to avoid up-scaling.
    return { w: source.w, h: source.h };
  }
  const scale = longSide / sourceLong;
  return {
    w: roundEven(source.w * scale),
    h: roundEven(source.h * scale),
  };
}

function roundEven(n: number): number {
  const r = Math.round(n);
  return r % 2 === 0 ? r : r - 1;
}

function detectPreset(value: { w: number; h: number }, source: { w: number; h: number }): Preset | "custom" {
  for (const p of PRESETS) {
    const dims = presetToDims(p.value, source);
    if (dims.w === value.w && dims.h === value.h) return p.value;
  }
  return "custom";
}

export function ResolutionPicker({ source, value, onChange }: Props) {
  const detected = useMemo(() => detectPreset(value, source), [value, source]);
  const [aspectLock, setAspectLock] = useState(true);
  const [wInput, setWInput] = useState(String(value.w));
  const [hInput, setHInput] = useState(String(value.h));

  // Sync local input strings when the parent updates the value (e.g. via a
  // preset chip click). We avoid one-way data flow into the input only when
  // the user is actively editing — easiest approximation: always mirror.
  useEffect(() => {
    setWInput(String(value.w));
    setHInput(String(value.h));
  }, [value.w, value.h]);

  const aspect = source.h === 0 ? 1 : source.w / source.h;

  function pickPreset(p: Preset) {
    onChange(presetToDims(p, source));
  }

  function commitW(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 16) return;
    const w = roundEven(n);
    const h = aspectLock ? roundEven(w / aspect) : value.h;
    onChange({ w, h });
  }

  function commitH(raw: string) {
    const n = parseInt(raw, 10);
    if (!Number.isFinite(n) || n < 16) return;
    const h = roundEven(n);
    const w = aspectLock ? roundEven(h * aspect) : value.w;
    onChange({ w, h });
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="label">Resolution</span>
      <div className="flex gap-1 flex-wrap">
        {PRESETS.map((p) => {
          const active = detected === p.value;
          return (
            <button
              key={p.value}
              type="button"
              onClick={() => pickPreset(p.value)}
              className={[
                "h-8 px-2.5 rounded-md text-[11px] font-display tracking-label uppercase border",
                active
                  ? "bg-ink text-paper-hi shadow-emboss border-rule/60"
                  : "bg-paper-hi text-ink-2 border-rule hover:bg-paper-deep",
              ].join(" ")}
            >
              {p.label}
            </button>
          );
        })}
      </div>

      <div className="flex items-end gap-2">
        {/* `min-w-0` on each column lets the input shrink inside the row.
         *  Without it, type=number inputs default to their intrinsic
         *  width (~120 px) and a 4-digit value pushes the Height input
         *  off the right edge of the side panel. */}
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span className="text-[10px] font-mono tracking-label uppercase text-ink-3">Width</span>
          <input
            type="number"
            inputMode="numeric"
            min={16}
            value={wInput}
            onChange={(e) => setWInput(e.target.value)}
            onBlur={() => commitW(wInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full min-w-0 bg-paper-hi border border-rule rounded-md h-9 px-2 font-mono text-sm tabular text-right"
          />
        </div>
        <button
          type="button"
          aria-label={aspectLock ? "Aspect locked" : "Aspect free"}
          onClick={() => setAspectLock((v) => !v)}
          className={[
            "h-9 w-9 shrink-0 rounded-md border flex items-center justify-center text-base mb-0",
            aspectLock
              ? "bg-paper-hi border-rule text-hot shadow-emboss"
              : "bg-paper-deep border-rule text-ink-3 shadow-pressed",
          ].join(" ")}
        >
          {aspectLock ? "🔒" : "🔓"}
        </button>
        <div className="flex flex-col gap-1 flex-1 min-w-0">
          <span className="text-[10px] font-mono tracking-label uppercase text-ink-3">Height</span>
          <input
            type="number"
            inputMode="numeric"
            min={16}
            value={hInput}
            onChange={(e) => setHInput(e.target.value)}
            onBlur={() => commitH(hInput)}
            onKeyDown={(e) => {
              if (e.key === "Enter") (e.target as HTMLInputElement).blur();
            }}
            className="w-full min-w-0 bg-paper-hi border border-rule rounded-md h-9 px-2 font-mono text-sm tabular text-right"
          />
        </div>
      </div>
    </div>
  );
}
