// The killer panel: knob + nudges + A/B + loop presets for live offset tuning.
// In multi-cam mode it follows whichever clip is selected in the Timeline,
// so each cam can be nudged independently.
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
  const clips = useEditorStore((s) => s.clips);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setSelectedClipId = useEditorStore((s) => s.setSelectedClipId);
  const setClipSyncOverride = useEditorStore((s) => s.setClipSyncOverride);
  const nudgeClipSyncOverride = useEditorStore((s) => s.nudgeClipSyncOverride);
  const abBypass = useEditorStore((s) => s.offset.abBypass);
  const setAbBypass = useEditorStore((s) => s.setAbBypass);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const trim = useEditorStore((s) => s.trim);
  const setLoop = useEditorStore((s) => s.setLoop);
  const loop = useEditorStore((s) => s.playback.loop);

  const selectedClip = clips.find((c) => c.id === selectedClipId) ?? null;
  const selectedIdx = selectedClip
    ? clips.findIndex((c) => c.id === selectedClip.id)
    : -1;

  const algoMs = selectedClip?.syncOffsetMs ?? 0;
  const userOverrideMs = selectedClip?.syncOverrideMs ?? 0;
  const totalMs = abBypass ? algoMs : algoMs + userOverrideMs;

  function setLoopAroundPlayhead(seconds: number) {
    const half = seconds / 2;
    const start = Math.max(trim.in, currentTime - half);
    const end = Math.min(trim.out, start + seconds);
    setLoop({ start, end });
  }

  function nudgeWithHaptic(delta: number) {
    if (!selectedClip) return;
    nudgeClipSyncOverride(selectedClip.id, delta);
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(8);
      } catch {
        /* ignore */
      }
    }
  }

  function setOverride(ms: number) {
    if (!selectedClip) return;
    setClipSyncOverride(selectedClip.id, ms);
  }

  const showResetToLast =
    lastSyncOverrideMs !== null &&
    selectedClip !== null &&
    lastSyncOverrideMs !== userOverrideMs;

  return (
    <div className="flex flex-col gap-5">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-ink min-w-0">
          <SyncIcon width={18} height={18} />
          <h2 className="font-display text-lg leading-none truncate">
            {selectedClip ? `Sync · Cam ${selectedIdx + 1}` : "Sync Tuner"}
          </h2>
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

      {!selectedClip ? (
        <SelectClipHint clips={clips} onPick={setSelectedClipId} />
      ) : (
        <>
          {/* Selected clip name */}
          <div
            className="rounded-md border border-rule px-3 py-2 flex items-center gap-2"
            style={{
              background: `linear-gradient(180deg, ${selectedClip.color}22 0%, ${selectedClip.color}11 100%)`,
              borderLeft: `4px solid ${selectedClip.color}`,
            }}
          >
            <span
              className="font-display font-semibold text-[11px] tracking-label uppercase"
              style={{ color: selectedClip.color }}
            >
              Cam {selectedIdx + 1}
            </span>
            <span className="font-mono text-[10px] text-ink-2 truncate">
              {selectedClip.filename}
            </span>
          </div>

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
              onChange={(v) => setOverride(v)}
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
              onClick={() => setOverride(0)}
              disabled={userOverrideMs === 0}
            >
              RESET TO ALGO
            </ChunkyButton>
            {showResetToLast && (
              <ChunkyButton
                variant="ghost"
                size="sm"
                onClick={() => setOverride(lastSyncOverrideMs ?? 0)}
              >
                USE LAST ({formatMs(lastSyncOverrideMs ?? 0, false).trim()})
              </ChunkyButton>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Empty state shown when the user hasn't picked a clip in the Timeline.
 * Lists every cam as a quick-pick chip so they don't have to chase the
 * pointer back to the timeline.
 */
function SelectClipHint({
  clips,
  onPick,
}: {
  clips: ReturnType<typeof useEditorStore.getState>["clips"];
  onPick: (id: string) => void;
}) {
  if (clips.length === 0) {
    return (
      <div className="rounded-md border border-dashed border-rule px-4 py-6 text-center">
        <p className="font-mono text-xs text-ink-2 leading-relaxed">
          No clips yet — upload at least one video to start tuning sync.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-md border border-dashed border-rule px-4 py-4 flex flex-col gap-3">
      <p className="font-mono text-xs text-ink-2 leading-relaxed text-center">
        Pick a clip in the timeline to tune its sync — or tap one here:
      </p>
      <div className="flex flex-wrap gap-2 justify-center">
        {clips.map((c, i) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onPick(c.id)}
            className="font-display tracking-label uppercase text-[10px] rounded-md border border-rule bg-paper-hi px-2.5 py-1.5 hover:bg-paper-deep transition-colors flex items-center gap-1.5"
            style={{ borderLeftColor: c.color, borderLeftWidth: 3 }}
          >
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: c.color }}
            />
            Cam {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}
