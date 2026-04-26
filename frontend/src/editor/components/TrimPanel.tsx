// In/out times + set-from-playhead + duration readout.
import { useEditorStore } from "../store";
import { ChunkyButton } from "./ChunkyButton";
import { MonoReadout, formatTime } from "./MonoReadout";
import { InIcon, OutIcon } from "./icons";

export function TrimPanel() {
  const meta = useEditorStore((s) => s.jobMeta);
  const trim = useEditorStore((s) => s.trim);
  const setTrim = useEditorStore((s) => s.setTrim);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const seek = useEditorStore((s) => s.seek);

  const dur = trim.out - trim.in;
  const totalDur = meta?.duration ?? 0;
  const trimmedAway = totalDur - dur;

  return (
    <div className="flex flex-col gap-5">
      <header>
        <h2 className="font-display text-lg leading-none">Trim</h2>
        <p className="text-xs text-ink-2 mt-1">
          Drag the handles on the timeline, or set in/out from the playhead.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2">
        <MonoReadout label="IN" tone="default" size="md" align="center" value={formatTime(trim.in)} />
        <MonoReadout label="OUT" tone="default" size="md" align="center" value={formatTime(trim.out)} />
      </div>
      <MonoReadout
        label="DURATION"
        tone="hot"
        size="lg"
        align="center"
        value={formatTime(dur)}
      />
      {trimmedAway > 0.05 && (
        <p className="text-[11px] text-ink-2 text-center">
          Trimming away{" "}
          <span className="font-mono tabular text-ink">{formatTime(trimmedAway)}</span>
        </p>
      )}

      <div className="grid grid-cols-2 gap-1.5">
        <ChunkyButton
          variant="primary"
          size="md"
          iconLeft={<InIcon />}
          onClick={() => setTrim({ in: currentTime, out: trim.out })}
        >
          IN @ Playhead
        </ChunkyButton>
        <ChunkyButton
          variant="primary"
          size="md"
          iconLeft={<OutIcon />}
          onClick={() => setTrim({ in: trim.in, out: currentTime })}
        >
          OUT @ Playhead
        </ChunkyButton>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        <ChunkyButton variant="secondary" size="sm" onClick={() => seek(trim.in)}>
          GO TO IN
        </ChunkyButton>
        <ChunkyButton variant="secondary" size="sm" onClick={() => seek(trim.out)}>
          GO TO OUT
        </ChunkyButton>
      </div>

      <ChunkyButton
        variant="ghost"
        size="sm"
        onClick={() => setTrim({ in: 0, out: totalDur })}
      >
        RESET (FULL)
      </ChunkyButton>
    </div>
  );
}
