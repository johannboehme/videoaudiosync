// The killer panel: knob + nudges + A/B + loop presets for live offset tuning.
import { useEditorStore } from "../store";
import { ChunkyButton } from "./ChunkyButton";
import { Knob } from "./Knob";
import { MonoReadout, formatMs } from "./MonoReadout";
import { SegmentedControl } from "./SegmentedControl";
import { SyncIcon } from "./icons";

interface Props {
  lastSyncOverrideMs: number | null;
}

export function SyncTuner({ lastSyncOverrideMs }: Props) {
  const meta = useEditorStore((s) => s.jobMeta);
  const userOverrideMs = useEditorStore((s) => s.offset.userOverrideMs);
  const abBypass = useEditorStore((s) => s.offset.abBypass);
  const setOffset = useEditorStore((s) => s.setOffset);
  const nudgeOffset = useEditorStore((s) => s.nudgeOffset);
  const setAbBypass = useEditorStore((s) => s.setAbBypass);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const trim = useEditorStore((s) => s.trim);
  const setLoop = useEditorStore((s) => s.setLoop);
  const loop = useEditorStore((s) => s.playback.loop);

  const algoMs = meta?.algoOffsetMs ?? 0;
  const totalMs = abBypass ? algoMs : algoMs + userOverrideMs;

  function setLoopAroundPlayhead(seconds: number) {
    const half = seconds / 2;
    const start = Math.max(trim.in, currentTime - half);
    const end = Math.min(trim.out, start + seconds);
    setLoop({ start, end });
  }

  function nudgeWithHaptic(delta: number) {
    nudgeOffset(delta);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* ignore */
      }
    }
  }

  const showResetToLast =
    lastSyncOverrideMs !== null &&
    lastSyncOverrideMs !== userOverrideMs;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-ink">
          <SyncIcon width={18} height={18} />
          <h2 className="font-display text-lg leading-none">Sync Tuner</h2>
        </div>
        <SegmentedControl
          value={abBypass ? "algo" : "override"}
          options={[
            { value: "algo", label: "A • ALGO" },
            { value: "override", label: "B • OVERRIDE" },
          ]}
          onChange={(v) => setAbBypass(v === "algo")}
          size="sm"
        />
      </header>

      {/* Algo + Total readouts side-by-side */}
      <div className="grid grid-cols-2 gap-2">
        <MonoReadout
          label="ALGO"
          tone="muted"
          size="md"
          align="center"
          value={formatMs(algoMs)}
        />
        <MonoReadout
          label={abBypass ? "PLAYING (A)" : "TOTAL"}
          tone="hot"
          size="md"
          align="center"
          value={formatMs(totalMs)}
        />
      </div>

      {/* Knob */}
      <div className="flex flex-col items-center gap-2 py-2">
        <Knob
          label="USER OVERRIDE"
          value={userOverrideMs}
          min={-2000}
          max={2000}
          step={0.5}
          pixelsPerRange={1400}
          onChange={(v) => setOffset(v)}
        />
        <MonoReadout
          tone="default"
          size="lg"
          align="center"
          className="w-44"
          value={formatMs(userOverrideMs)}
        />
        <span className="text-[10px] text-ink-3 font-mono tabular">
          drag • shift = fine • dbl-click = 0
        </span>
      </div>

      {/* Nudges */}
      <div className="flex flex-col gap-2">
        <span className="label">Nudge ms</span>
        <div className="grid grid-cols-6 gap-1.5">
          {[-100, -10, -1, 1, 10, 100].map((d) => (
            <ChunkyButton
              key={d}
              size="sm"
              variant={d > 0 ? "primary" : "secondary"}
              onClick={() => nudgeWithHaptic(d)}
            >
              {d > 0 ? `+${d}` : d}
            </ChunkyButton>
          ))}
        </div>
      </div>

      {/* Loop region presets */}
      <div className="flex flex-col gap-2">
        <span className="label">Practice Loop</span>
        <div className="grid grid-cols-4 gap-1.5">
          {[1, 2, 4].map((s) => (
            <ChunkyButton
              key={s}
              size="sm"
              variant="secondary"
              pressed={loop?.end !== undefined && Math.abs(loop.end - loop.start - s) < 0.05}
              onClick={() => setLoopAroundPlayhead(s)}
            >
              {s}s
            </ChunkyButton>
          ))}
          <ChunkyButton
            size="sm"
            variant="ghost"
            disabled={!loop}
            onClick={() => setLoop(null)}
          >
            CLEAR
          </ChunkyButton>
        </div>
      </div>

      {/* Resets */}
      <div className="grid grid-cols-2 gap-1.5">
        <ChunkyButton
          variant="ghost"
          size="sm"
          onClick={() => setOffset(0)}
          disabled={userOverrideMs === 0}
        >
          RESET TO ALGO
        </ChunkyButton>
        {showResetToLast && (
          <ChunkyButton
            variant="ghost"
            size="sm"
            onClick={() => setOffset(lastSyncOverrideMs ?? 0)}
          >
            USE LAST ({formatMs(lastSyncOverrideMs ?? 0, false).trim()})
          </ChunkyButton>
        )}
      </div>
    </div>
  );
}
