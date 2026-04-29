// Transport row with chunky play/pause + frame steppers + time readouts. Keyboard-aware.
import { useEffect } from "react";
import { useEditorStore } from "../store";
import { effectiveAudioStartS } from "../selectors/timing";
import { useRegisterShortcut } from "../shortcuts/useRegisterShortcut";
import { ChunkyButton } from "./ChunkyButton";
import { TransportClock } from "./TransportClock";
import {
  ArrowKeysIcon,
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
  // Visibility gates on the raw value: if the file is non-silent throughout
  // we have nothing meaningful to jump to. The seek target itself uses the
  // user-corrected (effective) start.
  const audioStartS = meta?.audioStartS ?? 0;
  const effectiveStart = effectiveAudioStartS(meta);

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

  useRegisterShortcut({
    id: "transport.playpause",
    keys: ["Space", "K"],
    description: "Play / pause",
    group: "Transport",
    icon: <PlayIcon />,
  });
  useRegisterShortcut({
    id: "transport.skipback",
    keys: ["J"],
    description: "Skip back 1 second",
    group: "Transport",
    icon: <SkipBackIcon />,
  });
  useRegisterShortcut({
    id: "transport.skipfwd",
    keys: ["L"],
    description: "Skip forward 1 second",
    group: "Transport",
    icon: <SkipFwdIcon />,
  });
  useRegisterShortcut({
    id: "transport.framestep",
    keys: ["←", "→"],
    description: "Step one frame (hold Shift for ±1 second)",
    group: "Transport",
    icon: <ArrowKeysIcon />,
  });
  useRegisterShortcut({
    id: "transport.in",
    keys: ["I"],
    description: "Set IN-point at the playhead",
    group: "Transport",
    icon: <InIcon />,
  });
  useRegisterShortcut({
    id: "transport.out",
    keys: ["O"],
    description: "Set OUT-point at the playhead",
    group: "Transport",
    icon: <OutIcon />,
  });

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
            onClick={() => seek(effectiveStart)}
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

      <TransportClock className="ml-auto" />
    </div>
  );
}
