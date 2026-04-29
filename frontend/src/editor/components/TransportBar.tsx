// Transport row with chunky play/pause + frame steppers + time readouts. Keyboard-aware.
import { useEffect } from "react";
import { useEditorStore } from "../store";
import { ChunkyButton } from "./ChunkyButton";
import { MonoReadout, formatTime } from "./MonoReadout";
import {
  AudioStartIcon,
  InIcon,
  LoopIcon,
  OutIcon,
  PauseIcon,
  PlayIcon,
  SkipBackIcon,
  SkipFwdIcon,
  StepBackIcon,
  StepFwdIcon,
} from "./icons";

export function TransportBar() {
  const meta = useEditorStore((s) => s.jobMeta);
  const isPlaying = useEditorStore((s) => s.playback.isPlaying);
  const setPlaying = useEditorStore((s) => s.setPlaying);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const trim = useEditorStore((s) => s.trim);
  const setTrim = useEditorStore((s) => s.setTrim);
  const loop = useEditorStore((s) => s.playback.loop);
  const setLoop = useEditorStore((s) => s.setLoop);
  const seek = useEditorStore((s) => s.seek);

  const fps = meta?.fps && meta.fps > 0 ? meta.fps : 30;
  const duration = meta?.duration ?? 0;
  const audioStartS = meta?.audioStartS ?? 0;

  function step(deltaSec: number) {
    seek(currentTime + deltaSec);
  }

  // Keyboard shortcuts (skip when an input/textarea is focused)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) {
        return;
      }
      // ignore if a knob is focused (it has its own handler)
      const ae = document.activeElement as HTMLElement | null;
      if (ae?.dataset?.knob) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          setPlaying(!isPlaying);
          break;
        case "k":
        case "K":
          e.preventDefault();
          setPlaying(!isPlaying);
          break;
        case "j":
        case "J":
          e.preventDefault();
          step(-1);
          break;
        case "l":
        case "L":
          e.preventDefault();
          step(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          step(e.shiftKey ? -1 : -1 / fps);
          break;
        case "ArrowRight":
          e.preventDefault();
          step(e.shiftKey ? 1 : 1 / fps);
          break;
        case "i":
        case "I":
          e.preventDefault();
          setTrim({ in: currentTime, out: trim.out });
          break;
        case "o":
        case "O":
          e.preventDefault();
          setTrim({ in: trim.in, out: currentTime });
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [currentTime, fps, isPlaying, setPlaying, setTrim, trim.in, trim.out, step]);

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-1">
        <ChunkyButton
          variant="secondary"
          size="md"
          onClick={() => seek(trim.in)}
          aria-label="Jump to in point"
        >
          <SkipBackIcon />
        </ChunkyButton>
        {audioStartS > 0 && (
          <ChunkyButton
            variant="secondary"
            size="md"
            onClick={() => seek(audioStartS)}
            aria-label="Jump to audio start"
          >
            <AudioStartIcon />
          </ChunkyButton>
        )}
        <ChunkyButton
          variant="secondary"
          size="md"
          onClick={() => step(-1 / fps)}
          aria-label="Previous frame"
        >
          <StepBackIcon />
        </ChunkyButton>
        <ChunkyButton
          variant="primary"
          size="lg"
          onClick={() => setPlaying(!isPlaying)}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <PauseIcon width={20} height={20} /> : <PlayIcon width={20} height={20} />}
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size="md"
          onClick={() => step(1 / fps)}
          aria-label="Next frame"
        >
          <StepFwdIcon />
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size="md"
          onClick={() => seek(trim.out)}
          aria-label="Jump to out point"
        >
          <SkipFwdIcon />
        </ChunkyButton>
      </div>

      <div className="h-8 w-px bg-rule mx-1" />

      <div className="flex items-center gap-1">
        <ChunkyButton
          variant="secondary"
          size="sm"
          onClick={() => setTrim({ in: currentTime, out: trim.out })}
          iconLeft={<InIcon />}
        >
          IN
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size="sm"
          onClick={() => setTrim({ in: trim.in, out: currentTime })}
          iconLeft={<OutIcon />}
        >
          OUT
        </ChunkyButton>
        <ChunkyButton
          variant={loop ? "primary" : "secondary"}
          pressed={!!loop}
          size="sm"
          onClick={() => setLoop(loop ? null : { start: currentTime, end: Math.min(duration, currentTime + 2) })}
          iconLeft={<LoopIcon />}
        >
          LOOP
        </ChunkyButton>
      </div>

      <div className="ml-auto flex items-center gap-3">
        <MonoReadout label="TIME" size="md" tone="hot" value={formatTime(currentTime)} />
        <span className="text-ink-3 font-mono text-xs">/</span>
        <MonoReadout label="DURATION" size="md" tone="muted" value={formatTime(duration)} />
      </div>
    </div>
  );
}
