// Canvas timeline: thumbnail strip + waveform + trim handles + loop region + playhead.
import { PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditorStore } from "../store";

interface Props {
  thumbnailsUrl: string;
  peaks: [number, number][];
  /** Duration of the studio audio file (peaks span). */
  audioDuration: number;
  height?: number;
}

type DragKind = "playhead" | "trim-in" | "trim-out" | "loop" | null;

const HANDLE_HIT = 14; // px tolerance for trim handle hit-testing

export function Timeline({ thumbnailsUrl, peaks, audioDuration, height = 88 }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const thumbsImg = useRef<HTMLImageElement | null>(null);
  const [thumbsReady, setThumbsReady] = useState(false);
  const [width, setWidth] = useState(800);
  const dragRef = useRef<DragKind>(null);
  const dragStartRef = useRef<{ x: number; t: number; loopOffset: number }>({
    x: 0,
    t: 0,
    loopOffset: 0,
  });

  const jobMeta = useEditorStore((s) => s.jobMeta);
  const trim = useEditorStore((s) => s.trim);
  const setTrim = useEditorStore((s) => s.setTrim);
  const loop = useEditorStore((s) => s.playback.loop);
  const setLoop = useEditorStore((s) => s.setLoop);
  const seek = useEditorStore((s) => s.seek);
  const zoom = useEditorStore((s) => s.ui.zoom);
  const scrollX = useEditorStore((s) => s.ui.scrollX);
  const setZoom = useEditorStore((s) => s.setZoom);
  const setScrollX = useEditorStore((s) => s.setScrollX);

  // Time axis is the VIDEO duration. Trim/loop/playhead all live in video time.
  // The audio peaks are mapped relative to the audio file's own duration, so a
  // peak at audio time t is drawn at video time t (1:1) — close enough for
  // visual reference. Algorithm offset is applied at render, not here.
  const duration = jobMeta?.duration || audioDuration || 0;
  // Visible window in seconds
  const visibleDur = duration / zoom;
  const viewStart = Math.min(scrollX, Math.max(0, duration - visibleDur));
  const viewEnd = viewStart + visibleDur;

  // Resize observer
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setWidth(w);
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // Load thumbs
  useEffect(() => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = thumbnailsUrl;
    img.onload = () => {
      thumbsImg.current = img;
      setThumbsReady(true);
    };
    img.onerror = () => setThumbsReady(false);
  }, [thumbnailsUrl]);

  const tToX = useCallback(
    (t: number) => ((t - viewStart) / visibleDur) * width,
    [viewStart, visibleDur, width],
  );
  const xToT = useCallback(
    (x: number) => viewStart + (x / width) * visibleDur,
    [viewStart, visibleDur, width],
  );

  // Subscribe to currentTime via selector (re-renders Timeline only when t changes)
  const currentTime = useEditorStore((s) => s.playback.currentTime);

  // Drawing
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // background
    ctx.fillStyle = "#E8E1D0";
    ctx.fillRect(0, 0, width, height);

    // thumbnails strip
    const thumbAreaTop = 0;
    const thumbAreaH = Math.floor(height * 0.55);
    if (thumbsReady && thumbsImg.current && duration > 0) {
      const img = thumbsImg.current;
      // The strip has N tiles spanning the full duration. Compute source x
      // for the visible window.
      const sxStart = (viewStart / duration) * img.width;
      const sxEnd = (viewEnd / duration) * img.width;
      const sw = Math.max(1, sxEnd - sxStart);
      ctx.drawImage(img, sxStart, 0, sw, img.height, 0, thumbAreaTop, width, thumbAreaH);
    } else {
      ctx.fillStyle = "#DDD4BE";
      ctx.fillRect(0, thumbAreaTop, width, thumbAreaH);
    }

    // waveform
    const wfTop = thumbAreaH;
    const wfH = height - wfTop;
    ctx.fillStyle = "rgba(26,24,22,0.06)";
    ctx.fillRect(0, wfTop, width, wfH);
    // Peaks are sampled across the full audio duration, but the timeline X
    // axis uses video duration. Map audio-time → video-time 1:1.
    if (peaks.length > 0 && audioDuration > 0) {
      const wfMid = wfTop + wfH / 2;
      const peaksPerSec = peaks.length / audioDuration;
      const startIdx = Math.max(0, Math.floor(viewStart * peaksPerSec));
      const endIdx = Math.min(peaks.length, Math.ceil(viewEnd * peaksPerSec));
      ctx.fillStyle = "#5C544A";
      // Aggregate peaks per pixel column for a clean filled-bar look (cheaper
      // to read than thin strokes when peaks-per-pixel > 1).
      let prevX = -1;
      let colMin = 0;
      let colMax = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const t = i / peaksPerSec;
        const x = Math.round(tToX(t));
        const [mn, mx] = peaks[i];
        if (x !== prevX) {
          if (prevX >= 0) {
            const yMax = wfMid - (Math.max(0, colMax) * wfH) / 2;
            const yMin = wfMid + (Math.max(0, -colMin) * wfH) / 2;
            ctx.fillRect(prevX, yMax, 1, Math.max(1, yMin - yMax));
          }
          prevX = x;
          colMin = mn;
          colMax = mx;
        } else {
          if (mn < colMin) colMin = mn;
          if (mx > colMax) colMax = mx;
        }
      }
      // flush last column
      if (prevX >= 0) {
        const yMax = wfMid - (Math.max(0, colMax) * wfH) / 2;
        const yMin = wfMid + (Math.max(0, -colMin) * wfH) / 2;
        ctx.fillRect(prevX, yMax, 1, Math.max(1, yMin - yMax));
      }
    }

    // dim outside trim
    const xIn = tToX(trim.in);
    const xOut = tToX(trim.out);
    ctx.fillStyle = "rgba(232,225,208,0.78)";
    if (xIn > 0) ctx.fillRect(0, 0, xIn, height);
    if (xOut < width) ctx.fillRect(xOut, 0, width - xOut, height);

    // loop band
    if (loop) {
      const xs = tToX(loop.start);
      const xe = tToX(loop.end);
      ctx.fillStyle = "rgba(255,87,34,0.18)";
      ctx.fillRect(xs, 0, Math.max(1, xe - xs), height);
      ctx.strokeStyle = "rgba(255,87,34,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(xs + 0.5, 0.5, Math.max(0, xe - xs - 1), height - 1);
    }

    // trim handles (top + bottom brackets)
    function drawHandle(x: number) {
      ctx.fillStyle = "#1A1816";
      ctx.fillRect(x - 1, 0, 2, height);
      // brackets
      ctx.fillStyle = "#1A1816";
      ctx.fillRect(x - 6, 0, 12, 8);
      ctx.fillRect(x - 6, height - 8, 12, 8);
      ctx.fillStyle = "#F2EDE2";
      ctx.fillRect(x - 1, 2, 2, 4);
      ctx.fillRect(x - 1, height - 6, 2, 4);
    }
    drawHandle(xIn);
    drawHandle(xOut);

    // playhead
    const xp = tToX(currentTime);
    ctx.strokeStyle = "#FF5722";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xp, 0);
    ctx.lineTo(xp, height);
    ctx.stroke();
    // playhead grip
    ctx.fillStyle = "#FF5722";
    ctx.beginPath();
    ctx.moveTo(xp - 6, 0);
    ctx.lineTo(xp + 6, 0);
    ctx.lineTo(xp, 9);
    ctx.closePath();
    ctx.fill();
  }, [
    width,
    height,
    thumbsReady,
    viewStart,
    viewEnd,
    duration,
    peaks,
    trim.in,
    trim.out,
    loop,
    currentTime,
    tToX,
  ]);

  function classifyHit(x: number): DragKind {
    const xp = tToX(currentTime);
    const xIn = tToX(trim.in);
    const xOut = tToX(trim.out);
    if (Math.abs(x - xIn) <= HANDLE_HIT) return "trim-in";
    if (Math.abs(x - xOut) <= HANDLE_HIT) return "trim-out";
    if (Math.abs(x - xp) <= HANDLE_HIT) return "playhead";
    if (loop) {
      const xs = tToX(loop.start);
      const xe = tToX(loop.end);
      if (x >= xs && x <= xe) return "loop";
    }
    return null;
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = xToT(x);
    const kind = classifyHit(x);
    if (kind === null) {
      // click outside any handle = seek + start playhead drag
      seek(t);
      dragRef.current = "playhead";
      dragStartRef.current = { x, t, loopOffset: 0 };
    } else {
      dragRef.current = kind;
      dragStartRef.current = {
        x,
        t,
        loopOffset: kind === "loop" && loop ? t - loop.start : 0,
      };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(duration, xToT(x)));
    if (dragRef.current === "playhead") {
      seek(t);
    } else if (dragRef.current === "trim-in") {
      setTrim({ in: t, out: trim.out });
    } else if (dragRef.current === "trim-out") {
      setTrim({ in: trim.in, out: t });
    } else if (dragRef.current === "loop" && loop) {
      const len = loop.end - loop.start;
      const newStart = Math.max(trim.in, Math.min(trim.out - len, t - dragStartRef.current.loopOffset));
      setLoop({ start: newStart, end: newStart + len });
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Wheel zoom: cursor stays anchored at the same time-position
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tAtCursor = xToT(x);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = Math.max(1, Math.min(64, zoom * factor));
    if (newZoom === zoom) return;
    const newVisible = duration / newZoom;
    const newScroll = Math.max(0, Math.min(duration - newVisible, tAtCursor - (x / width) * newVisible));
    setZoom(newZoom);
    setScrollX(newScroll);
  };

  // Pinch zoom (touch): handled via two-pointer tracking in the parent gesture lib
  // — simplified: skip pinch for now, two-finger scroll still works via wheel events on iOS Safari.

  // Cursor hint
  const [hoverCursor, setHoverCursor] = useState<string>("crosshair");
  const onPointerHover = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const k = classifyHit(x);
    setHoverCursor(
      k === "trim-in" || k === "trim-out"
        ? "ew-resize"
        : k === "playhead"
          ? "grab"
          : k === "loop"
            ? "move"
            : "crosshair",
    );
  };

  const zoomPercent = useMemo(() => Math.round(zoom * 100), [zoom]);

  return (
    <div ref={wrapRef} className="w-full select-none">
      <div className="flex items-center justify-between px-1 mb-1.5">
        <div className="flex items-center gap-2">
          <span className="label">Timeline</span>
          <span className="text-[10px] tabular text-ink-3 font-mono">
            {zoomPercent}%
          </span>
        </div>
        <div className="text-[10px] tabular text-ink-3 font-mono">
          {viewStart.toFixed(1)}s — {viewEnd.toFixed(1)}s
        </div>
      </div>
      <div className="rounded-md overflow-hidden border border-rule shadow-panel bg-paper-deep">
        <canvas
          ref={canvasRef}
          onPointerDown={onPointerDown}
          onPointerMove={(e) => {
            onPointerMove(e);
            onPointerHover(e);
          }}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onWheel={onWheel}
          style={{ cursor: hoverCursor, touchAction: "none", display: "block" }}
        />
      </div>
    </div>
  );
}
