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
  // Don't subscribe to currentTime here — it changes 60×/sec while
  // playing and would re-render this whole bar (and re-bind the
  // keyboard listener via the useEffect deps). All consumers below are
  // click/keyboard handlers; they read the current value imperatively
  // via getState() at the moment of the action.
  const trim = useEditorStore((s) => s.trim);
  const setTrim = useEditorStore((s) => s.setTrim);
  const loop = useEditorStore((s) => s.playback.loop);
  const setLoop = useEditorStore((s) => s.setLoop);
  const seek = useEditorStore((s) => s.seek);
  const stepByActiveSnap = useEditorStore((s) => s.stepByActiveSnap);
  const shiftLoop = useEditorStore((s) => s.shiftLoop);
  // Phone-sized viewports get an aggressively compacted transport bar:
  // every transport stepper + Play + IN/OUT/LOOP collapses to xs
  // (h-8 ≈ 28 px wide icon-only, no min-w) so the entire 8-button
  // block fits on ONE row at 280 px — vs the 2 we landed at last pass
  // and the 4 the original design produced. Play keeps its primary
  // (hot-orange) variant so it still reads as the main affordance
  // even at the same physical size as the steppers.
  const isNarrow = useIsNarrowViewport();
  const btnSize = isNarrow ? "xs" : "md";
  const playSize = isNarrow ? "xs" : "lg";
  const trimSize = isNarrow ? "xs" : "sm";

  const fps = meta?.fps && meta.fps > 0 ? meta.fps : 30;
  const duration = meta?.duration ?? 0;
  // Visibility gates on the raw value: if the file is non-silent throughout
  // we have nothing meaningful to jump to. The seek target itself uses the
  // user-corrected (effective) start.
  const audioStartS = meta?.audioStartS ?? 0;
  const effectiveStart = effectiveAudioStartS(meta);

  function step(deltaSec: number) {
    const t = useEditorStore.getState().playback.currentTime;
    seek(t + deltaSec);
  }

  // IN/OUT semantics are modal: while a loop region is active they edit
  // the loop boundaries (so the user can sculpt a practice loop with the
  // playhead); otherwise they edit the trim/export region. Same logic in
  // both the buttons and the I/O shortcuts.
  function setInPointAtPlayhead() {
    const t = useEditorStore.getState().playback.currentTime;
    if (loop) {
      const newStart = t;
      const newEnd = Math.max(loop.end, newStart + 1 / fps);
      setLoop({ start: newStart, end: newEnd });
    } else {
      setTrim({ in: t, out: trim.out });
    }
  }
  function setOutPointAtPlayhead() {
    const t = useEditorStore.getState().playback.currentTime;
    if (loop) {
      const newEnd = t;
      const newStart = Math.min(loop.start, newEnd - 1 / fps);
      setLoop({ start: newStart, end: newEnd });
    } else {
      setTrim({ in: trim.in, out: t });
    }
  }

  function toggleLoop() {
    if (loop) {
      setLoop(null);
      return;
    }
    const t = useEditorStore.getState().playback.currentTime;
    setLoop({ start: t, end: Math.min(duration, t + 2) });
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
        case "ArrowLeft":
          e.preventDefault();
          if (e.altKey) shiftLoop(-1);
          else stepByActiveSnap(-1);
          break;
        case "ArrowRight":
          e.preventDefault();
          if (e.altKey) shiftLoop(1);
          else stepByActiveSnap(1);
          break;
        case "i":
        case "I":
          e.preventDefault();
          setInPointAtPlayhead();
          break;
        case "o":
        case "O":
          e.preventDefault();
          setOutPointAtPlayhead();
          break;
        case "l":
        case "L":
          e.preventDefault();
          toggleLoop();
          break;
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    fps,
    duration,
    isPlaying,
    loop,
    setPlaying,
    setLoop,
    setTrim,
    trim.in,
    trim.out,
    stepByActiveSnap,
    shiftLoop,
  ]);

  useRegisterShortcut({
    id: "transport.playpause",
    keys: ["Space"],
    description: "Play / pause",
    group: "Transport",
    icon: <PlayIcon />,
  });
  useRegisterShortcut({
    id: "transport.framestep",
    keys: ["←", "→"],
    description: "Step by snap target (frame, beat, bar, or match-point)",
    group: "Transport",
    icon: <ArrowKeysIcon />,
  });
  useRegisterShortcut({
    id: "transport.loopshift",
    keys: ["⌥←", "⌥→"],
    description: "Shift loop region by its length (OP-1 style; playback continues)",
    group: "Transport",
    icon: <LoopIcon />,
  });
  useRegisterShortcut({
    id: "transport.in",
    keys: ["I"],
    description: loop
      ? "Set loop in-point at the playhead"
      : "Set trim in-point at the playhead",
    group: "Transport",
    icon: <InIcon />,
  });
  useRegisterShortcut({
    id: "transport.out",
    keys: ["O"],
    description: loop
      ? "Set loop out-point at the playhead"
      : "Set trim out-point at the playhead",
    group: "Transport",
    icon: <OutIcon />,
  });
  useRegisterShortcut({
    id: "transport.loop",
    keys: ["L"],
    description: loop
      ? "Disable loop"
      : "Loop a 2-second region from the playhead",
    group: "Transport",
    icon: <LoopIcon />,
  });

  return (
    // Mobile flattens the two button groups into a single flex row
    // (no nested wrappers, no inter-group gap) so all 8 icons fit on
    // ONE row at 280 px. Desktop keeps the wider gap + divider between
    // transport and IN/OUT/LOOP groups via the wrapper structure
    // below.
    <div
      className={
        isNarrow
          ? "flex items-center gap-0.5"
          : "flex items-center gap-x-3 gap-y-2 flex-wrap"
      }
    >
      <div className={`flex items-center ${isNarrow ? "contents" : "flex-wrap gap-1"}`}>
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

      {/* The vertical divider is meaningful only when both groups sit
       *  on the same row visually distinct; on narrow widths we drop
       *  it (along with the wrapper structure) so all 8 buttons sit
       *  in one flat flex row. */}
      <div className="hidden sm:block h-8 w-px bg-rule mx-1" />

      <div className={`flex items-center ${isNarrow ? "contents" : "flex-wrap gap-1"}`}>
        <ChunkyButton
          variant="secondary"
          size={trimSize}
          onClick={setInPointAtPlayhead}
          iconLeft={<InIcon />}
          aria-label={loop ? "Set loop in-point at the playhead" : "Set in-point at the playhead"}
        >
          {!isNarrow && "IN"}
        </ChunkyButton>
        <ChunkyButton
          variant="secondary"
          size={trimSize}
          onClick={setOutPointAtPlayhead}
          iconLeft={<OutIcon />}
          aria-label={loop ? "Set loop out-point at the playhead" : "Set out-point at the playhead"}
        >
          {!isNarrow && "OUT"}
        </ChunkyButton>
        <ChunkyButton
          variant={loop ? "primary" : "secondary"}
          pressed={!!loop}
          size={trimSize}
          onClick={toggleLoop}
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
