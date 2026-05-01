// Transport row with chunky play/pause + frame steppers + time readouts. Keyboard-aware.
import { useEffect } from "react";
import { useEditorStore } from "../store";
import { effectiveAudioStartS } from "../selectors/timing";
import { useRegisterShortcut } from "../shortcuts/useRegisterShortcut";
import { useIsNarrowViewport } from "../use-is-narrow";
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
  // Phone-sized viewports get an aggressively compacted transport bar:
  // every button drops to size="sm" (h-9, 36 px touch target) and IN /
  // OUT / LOOP lose their text label so the row fits in 2 stacked
  // rows instead of the previous 4 on a 280-px-wide Galaxy Fold.
  const isNarrow = useIsNarrowViewport();
  const btnSize = isNarrow ? "sm" : "md";
  const playSize = isNarrow ? "md" : "lg";

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
    // Mobile collapses gap-y to 1 (4 px) so two rows feel like one
    // compact block; desktop keeps the original spacing.
    <div className={`flex items-center flex-wrap ${isNarrow ? "gap-x-1 gap-y-1" : "gap-x-3 gap-y-2"}`}>
      <div className={`flex items-center flex-wrap ${isNarrow ? "gap-0.5" : "gap-1"}`}>
        <ChunkyButton
          variant="secondary"
          size={btnSize}
          onClick={() => seek(trim.in)}
          aria-label="Jump to in point"
        >
          <SkipBackIcon />
        </ChunkyButton>
        {audioStartS > 0 && !isNarrow && (
          <ChunkyButton
            variant="secondary"
            size={btnSize}
            onClick={() => seek(effectiveStart)}
            aria-label="Jump to audio start"
          >
            <AudioStartIcon />
          </ChunkyButton>
        )}
        <ChunkyButton
          variant="secondary"
          size={btnSize}
          onClick={() => step(-1 / fps)}
          aria-label="Previous frame"
        >
          <StepBackIcon />
        </ChunkyButton>
        <ChunkyButton
          variant="primary"
          size={playSize}
          onClick={() => setPlaying(!isPlaying)}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? (
            <PauseIcon width={isNarrow ? 16 : 20} height={isNarrow ? 16 : 20} />
          ) : (
            <PlayIcon width={isNarrow ? 16 : 20} height={isNarrow ? 16 : 20} />
          )}
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size={btnSize}
          onClick={() => step(1 / fps)}
          aria-label="Next frame"
        >
          <StepFwdIcon />
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size={btnSize}
          onClick={() => seek(trim.out)}
          aria-label="Jump to out point"
        >
          <SkipFwdIcon />
        </ChunkyButton>
      </div>

      {/* The vertical divider is meaningful only when both groups sit on
       *  the same row; on narrow widths the row wraps, so hide it. */}
      <div className="hidden sm:block h-8 w-px bg-rule mx-1" />

      <div className={`flex items-center flex-wrap ${isNarrow ? "gap-0.5" : "gap-1"}`}>
        <ChunkyButton
          variant="secondary"
          size="sm"
          onClick={() => setTrim({ in: currentTime, out: trim.out })}
          iconLeft={<InIcon />}
          aria-label="Set in-point at the playhead"
        >
          {!isNarrow && "IN"}
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size="sm"
          onClick={() => setTrim({ in: trim.in, out: currentTime })}
          iconLeft={<OutIcon />}
          aria-label="Set out-point at the playhead"
        >
          {!isNarrow && "OUT"}
        </ChunkyButton>
        <ChunkyButton
          variant={loop ? "primary" : "secondary"}
          pressed={!!loop}
          size="sm"
          onClick={() => setLoop(loop ? null : { start: currentTime, end: Math.min(duration, currentTime + 2) })}
          iconLeft={<LoopIcon />}
          aria-label={loop ? "Disable loop" : "Loop a 2-second region from the playhead"}
        >
          {!isNarrow && "LOOP"}
        </ChunkyButton>
      </div>

      {/* Clock: hidden on phones — the timeline ruler shows the same
       *  master time, and the bezel here was eating an entire row.
       *  Desktop still floats it to the right of the IN/OUT/LOOP group. */}
      {!isNarrow && <TransportClock className="sm:ml-auto" />}
    </div>
  );
}
