/**
 * Multi-lane Timeline.
 *
 * Layout (left → right): one column of HTML headers (PROGRAM label, per-cam
 * Lane-Headers, MASTER AUDIO label), then a single full-height canvas that
 * draws every lane in horizontal bands. The PROGRAM strip on top and the
 * custom hardware-mixer scrollbar at the bottom are HTML — they need rich
 * skeuomorph styling and live above/below the canvas.
 *
 * The canvas hosts: video-lane thumbnail tiles + clip pills + audio waveform
 * + trim handles + loop region + the global playhead. One canvas keeps the
 * playhead a single straight line spanning every lane.
 */
import {
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useEditorStore } from "../store";
import { clipRangeS, type VideoClip } from "../types";
import { LaneHeader, type CamStatus } from "./timeline/LaneHeader";
import { ProgramStrip } from "./timeline/ProgramStrip";

interface CamAssetInfo {
  /** OPFS object URL for this cam's thumbnail strip (may be null). */
  framesUrl: string | null;
  /** Source aspect ratio (width / height) — drives thumbnail tile geometry. */
  aspect: number;
}

interface Props {
  /** Per-cam asset info, keyed by camId. */
  cams: Record<string, CamAssetInfo>;
  peaks: [number, number][];
  audioDuration: number;
  /** Audio-lane height in px. Defaults to the legacy 88 to keep the waveform familiar. */
  audioLaneHeight?: number;
  /** Per-video-lane height in px. */
  videoLaneHeight?: number;
}

type DragKind =
  | { kind: "playhead" }
  | { kind: "trim-in" }
  | { kind: "trim-out" }
  | { kind: "loop"; offset: number }
  | { kind: "clip-move"; camId: string; grabT: number; origStartOffsetS: number }
  | { kind: "scrollbar"; offsetX: number };

const HANDLE_HIT = 14;
const TARGET_TILE_W = 64;
const HEADER_W = 156;
const SCROLLBAR_H = 14;

export function Timeline({
  cams,
  peaks,
  audioDuration,
  audioLaneHeight = 88,
  videoLaneHeight = 80,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const dragRef = useRef<DragKind | null>(null);

  // Store reads — narrow selectors to keep re-renders cheap.
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
  const clips = useEditorStore((s) => s.clips);
  const cuts = useEditorStore((s) => s.cuts);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const setSelectedClipId = useEditorStore((s) => s.setSelectedClipId);
  const setClipStartOffset = useEditorStore((s) => s.setClipStartOffset);
  const addCut = useEditorStore((s) => s.addCut);
  const overwriteCutsRange = useEditorStore((s) => s.overwriteCutsRange);
  const removeCutAt = useEditorStore((s) => s.removeCutAt);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const takeHoldStartRef = useRef<Map<string, number>>(new Map());

  const duration = jobMeta?.duration || audioDuration || 0;
  const visibleDur = duration / zoom;
  const viewStart = Math.min(scrollX, Math.max(0, duration - visibleDur));
  const viewEnd = viewStart + visibleDur;

  // ---- Layout offsets (canvas y-coordinates per lane) ----
  const videoBands = clips.map((_, i) => ({
    top: i * videoLaneHeight,
    bottom: (i + 1) * videoLaneHeight,
  }));
  const audioBand = {
    top: clips.length * videoLaneHeight,
    bottom: clips.length * videoLaneHeight + audioLaneHeight,
  };
  const canvasH = audioBand.bottom;

  // ---- Resize observer ----
  useEffect(() => {
    if (!wrapRef.current) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0].contentRect.width;
      setCanvasWidth(Math.max(0, w - HEADER_W));
    });
    ro.observe(wrapRef.current);
    return () => ro.disconnect();
  }, []);

  // ---- Per-cam thumbnail Image objects ----
  const camImagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const [camImagesReady, setCamImagesReady] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const map = new Map<string, HTMLImageElement>();
    let pending = 0;
    for (const clip of clips) {
      const url = cams[clip.id]?.framesUrl;
      if (!url) continue;
      pending++;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.src = url;
      img.onload = () => {
        if (cancelled) return;
        map.set(clip.id, img);
        camImagesRef.current = map;
        setCamImagesReady((n) => n + 1);
      };
      img.onerror = () => {
        if (!cancelled) setCamImagesReady((n) => n + 1);
      };
    }
    if (pending === 0) {
      camImagesRef.current = map;
      setCamImagesReady((n) => n + 1);
    }
    return () => {
      cancelled = true;
    };
  }, [clips, cams]);

  // ---- t↔x helpers ----
  const tToX = useCallback(
    (t: number) => ((t - viewStart) / visibleDur) * canvasWidth,
    [viewStart, visibleDur, canvasWidth],
  );
  const xToT = useCallback(
    (x: number) => viewStart + (x / canvasWidth) * visibleDur,
    [viewStart, visibleDur, canvasWidth],
  );

  // ---- Active-cam status per lane (drives LED color) ----
  const camStatusByCamId = useMemo(() => {
    const result: Record<string, CamStatus> = {};
    const ranges = clips.map((c) => {
      const r = clipRangeS(c);
      return { id: c.id, startS: r.startS, endS: r.endS };
    });
    const activeId = (() => {
      const s = useEditorStore.getState();
      return s.activeCamId(currentTime);
    })();
    for (const cam of clips) {
      const range = ranges.find((r) => r.id === cam.id)!;
      const hasMaterial = currentTime >= range.startS && currentTime < range.endS;
      const status: CamStatus =
        cam.id === activeId
          ? "on-air"
          : hasMaterial
            ? "available"
            : "off";
      result[cam.id] = status;
    }
    return result;
  }, [clips, cuts, currentTime]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- Canvas drawing ----
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || canvasWidth === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(canvasWidth * dpr));
    canvas.height = Math.max(1, Math.floor(canvasH * dpr));
    canvas.style.width = `${canvasWidth}px`;
    canvas.style.height = `${canvasH}px`;
    const ctx2d = canvas.getContext("2d");
    if (!ctx2d) return;
    const ctx: CanvasRenderingContext2D = ctx2d;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background — paper-deep, the same tone the unselected SidePanel tabs
    // sit on. Keeps the timeline inside the existing palette.
    ctx.fillStyle = "#E8E1D0"; // paper-deep
    ctx.fillRect(0, 0, canvasWidth, canvasH);

    // Per-video-lane: thumbnails + clip pill.
    for (let i = 0; i < clips.length; i++) {
      const clip = clips[i];
      const band = videoBands[i];
      drawVideoLane({
        ctx,
        clip,
        bandTop: band.top,
        bandH: videoLaneHeight,
        canvasWidth,
        viewStart,
        visibleDur,
        img: camImagesRef.current.get(clip.id) ?? null,
        aspect: cams[clip.id]?.aspect ?? 16 / 9,
        selected: clip.id === selectedClipId,
      });
      // Lane separator line below each video lane (subtle sepia rule).
      ctx.fillStyle = "#D8CFB8";
      ctx.fillRect(0, band.bottom - 1, canvasWidth, 1);
    }

    // Audio lane background — paper-panel, the only sibling tone in the
    // palette. Sets the audio band apart from the video lanes without
    // introducing a new hex.
    ctx.fillStyle = "#DDD4BE"; // paper-panel
    ctx.fillRect(0, audioBand.top, canvasWidth, audioLaneHeight);

    // Audio waveform — same logic as before.
    if (peaks.length > 0 && audioDuration > 0) {
      const wfMid = audioBand.top + audioLaneHeight / 2;
      const peaksPerSec = peaks.length / audioDuration;
      const startIdx = Math.max(0, Math.floor(viewStart * peaksPerSec));
      const endIdx = Math.min(peaks.length, Math.ceil(viewEnd * peaksPerSec));
      ctx.fillStyle = "#5C544A";
      let prevX = -1;
      let colMin = 0;
      let colMax = 0;
      for (let i = startIdx; i < endIdx; i++) {
        const t = i / peaksPerSec;
        const x = Math.round(tToX(t));
        const [mn, mx] = peaks[i];
        if (x !== prevX) {
          if (prevX >= 0) {
            const yMax = wfMid - (Math.max(0, colMax) * audioLaneHeight) / 2;
            const yMin = wfMid + (Math.max(0, -colMin) * audioLaneHeight) / 2;
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
      if (prevX >= 0) {
        const yMax = wfMid - (Math.max(0, colMax) * audioLaneHeight) / 2;
        const yMin = wfMid + (Math.max(0, -colMin) * audioLaneHeight) / 2;
        ctx.fillRect(prevX, yMax, 1, Math.max(1, yMin - yMax));
      }
    }

    // Trim dim — shading on AUDIO lane only, since trim still refers to the
    // master-audio render bounds.
    const xIn = tToX(trim.in);
    const xOut = tToX(trim.out);
    ctx.fillStyle = "rgba(232,225,208,0.78)";
    if (xIn > 0) ctx.fillRect(0, audioBand.top, xIn, audioLaneHeight);
    if (xOut < canvasWidth)
      ctx.fillRect(xOut, audioBand.top, canvasWidth - xOut, audioLaneHeight);

    // Loop band on audio lane.
    if (loop) {
      const xs = tToX(loop.start);
      const xe = tToX(loop.end);
      ctx.fillStyle = "rgba(255,87,34,0.18)";
      ctx.fillRect(xs, audioBand.top, Math.max(1, xe - xs), audioLaneHeight);
      ctx.strokeStyle = "rgba(255,87,34,0.6)";
      ctx.lineWidth = 1;
      ctx.strokeRect(
        xs + 0.5,
        audioBand.top + 0.5,
        Math.max(0, xe - xs - 1),
        audioLaneHeight - 1,
      );
    }

    // Trim handles on the audio lane (top + bottom brackets).
    drawHandle(ctx, xIn, audioBand.top, audioLaneHeight);
    drawHandle(ctx, xOut, audioBand.top, audioLaneHeight);

    // Playhead — spans all lanes.
    const xp = tToX(currentTime);
    ctx.strokeStyle = "#FF5722";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(xp, 0);
    ctx.lineTo(xp, canvasH);
    ctx.stroke();
    // Playhead grip (top).
    ctx.fillStyle = "#FF5722";
    ctx.beginPath();
    ctx.moveTo(xp - 6, 0);
    ctx.lineTo(xp + 6, 0);
    ctx.lineTo(xp, 9);
    ctx.closePath();
    ctx.fill();
  }, [
    canvasWidth,
    canvasH,
    audioBand.top,
    audioLaneHeight,
    videoLaneHeight,
    viewStart,
    viewEnd,
    visibleDur,
    duration,
    peaks,
    audioDuration,
    trim.in,
    trim.out,
    loop,
    currentTime,
    clips,
    cams,
    selectedClipId,
    camImagesReady,
    tToX,
    videoBands,
  ]);

  // ---- Hit-testing & drag ----
  function findClipAt(x: number, y: number): { clip: VideoClip; band: { top: number; bottom: number } } | null {
    for (let i = 0; i < clips.length; i++) {
      const band = videoBands[i];
      if (y < band.top || y >= band.bottom) continue;
      const range = clipRangeS(clips[i]);
      const x1 = tToX(range.startS);
      const x2 = tToX(range.endS);
      if (x >= x1 && x <= x2) return { clip: clips[i], band };
      return null; // hit the lane but missed the pill → no clip selected
    }
    return null;
  }

  function classifyAudioHit(x: number): "trim-in" | "trim-out" | "playhead" | "loop" | null {
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
    const y = e.clientY - rect.top;
    const t = xToT(x);

    // Audio lane → existing trim/loop/playhead/seek behavior.
    if (y >= audioBand.top) {
      const k = classifyAudioHit(x);
      if (k === null) {
        seek(t);
        dragRef.current = { kind: "playhead" };
      } else if (k === "trim-in") {
        dragRef.current = { kind: "trim-in" };
      } else if (k === "trim-out") {
        dragRef.current = { kind: "trim-out" };
      } else if (k === "playhead") {
        dragRef.current = { kind: "playhead" };
      } else if (k === "loop" && loop) {
        dragRef.current = { kind: "loop", offset: t - loop.start };
      }
      return;
    }

    // Video lane:
    //   * Click on a clip pill — select the clip; default drag = scrub the
    //     playhead (most common). Hold Alt while dragging to reposition the
    //     clip in time instead. NLE-style.
    //   * Click on empty lane — deselect, seek + scrub.
    const hit = findClipAt(x, y);
    if (hit) {
      setSelectedClipId(hit.clip.id);
      if (e.altKey) {
        dragRef.current = {
          kind: "clip-move",
          camId: hit.clip.id,
          grabT: t,
          origStartOffsetS: hit.clip.startOffsetS,
        };
      } else {
        seek(t);
        dragRef.current = { kind: "playhead" };
      }
    } else {
      setSelectedClipId(null);
      seek(t);
      dragRef.current = { kind: "playhead" };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const t = Math.max(0, Math.min(duration, xToT(x)));
    const drag = dragRef.current;
    if (drag.kind === "playhead") {
      seek(t);
    } else if (drag.kind === "trim-in") {
      setTrim({ in: t, out: trim.out });
    } else if (drag.kind === "trim-out") {
      setTrim({ in: trim.in, out: t });
    } else if (drag.kind === "loop" && loop) {
      const len = loop.end - loop.start;
      const newStart = Math.max(trim.in, Math.min(trim.out - len, t - drag.offset));
      setLoop({ start: newStart, end: newStart + len });
    } else if (drag.kind === "clip-move") {
      const deltaT = xToT(x) - drag.grabT;
      setClipStartOffset(drag.camId, drag.origStartOffsetS + deltaT);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
  };

  // Wheel zoom — same anchored-zoom behavior as before.
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tAtCursor = xToT(x);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = Math.max(1, Math.min(64, zoom * factor));
    if (newZoom === zoom) return;
    const newVisible = duration / newZoom;
    const newScroll = Math.max(0, Math.min(duration - newVisible, tAtCursor - (x / canvasWidth) * newVisible));
    setZoom(newZoom);
    setScrollX(newScroll);
  };

  // ---- Custom hardware-mixer scrollbar (cherry-picked from feature/clip-studio) ----
  const scrollbarVisible = zoom > 1.001 && duration > 0;
  const thumbW = scrollbarVisible
    ? Math.max(28, (visibleDur / duration) * canvasWidth)
    : canvasWidth;
  const thumbX = scrollbarVisible ? (viewStart / duration) * canvasWidth : 0;

  const onScrollPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrollbarVisible) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < thumbX || x > thumbX + thumbW) {
      // Jump-scroll so the thumb centers under the click.
      const newThumbX = Math.max(0, Math.min(canvasWidth - thumbW, x - thumbW / 2));
      setScrollX((newThumbX / canvasWidth) * duration);
      dragRef.current = { kind: "scrollbar", offsetX: thumbW / 2 };
    } else {
      dragRef.current = { kind: "scrollbar", offsetX: x - thumbX };
    }
  };
  const onScrollPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragRef.current || dragRef.current.kind !== "scrollbar") return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const newThumbX = Math.max(0, Math.min(canvasWidth - thumbW, x - dragRef.current.offsetX));
    setScrollX((newThumbX / canvasWidth) * duration);
  };
  const onScrollPointerUp = () => {
    if (dragRef.current?.kind === "scrollbar") dragRef.current = null;
  };

  // Cursor hint
  const [hoverCursor, setHoverCursor] = useState<string>("default");
  const onPointerHover = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y >= audioBand.top) {
      const k = classifyAudioHit(x);
      setHoverCursor(
        k === "trim-in" || k === "trim-out"
          ? "ew-resize"
          : k === "playhead"
            ? "grab"
            : k === "loop"
              ? "move"
              : "crosshair",
      );
    } else {
      // Video lane — over a clip the cursor is `pointer` (clip is selectable
      // + scrub-draggable). Alt-modifier shows a `move` cursor to hint at
      // the alternate clip-move drag behavior.
      const overClip = findClipAt(x, y);
      if (overClip) {
        setHoverCursor(e.altKey ? "move" : "pointer");
      } else {
        setHoverCursor("crosshair");
      }
    }
  };

  const zoomPercent = useMemo(() => Math.round(zoom * 100), [zoom]);

  // Build CamLookups for the PROGRAM strip.
  const camLookupsForStrip = useMemo(
    () =>
      clips.map((c) => ({
        id: c.id,
        color: c.color,
        range: clipRangeS(c),
      })),
    [clips],
  );

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

      <div className="rounded-md overflow-hidden border border-rule shadow-panel bg-paper-hi-deep">
        {/* PROGRAM-Strip row */}
        <div className="flex">
          <div
            className="shrink-0 flex items-center px-3 border-r border-b border-rule bg-paper-hi"
            style={{ width: HEADER_W, height: 32 }}
          >
            <span className="font-mono text-[9px] tracking-label uppercase text-ink-2">
              PROGRAM
            </span>
          </div>
          <div className="flex-1 relative" style={{ width: canvasWidth }}>
            <ProgramStrip
              cuts={cuts}
              cams={camLookupsForStrip}
              duration={duration}
              viewStartS={viewStart}
              viewEndS={viewEnd}
              width={canvasWidth}
              onRemoveCut={removeCutAt}
            />
          </div>
        </div>

        {/* Lanes row: HTML headers on the left, single canvas on the right */}
        <div className="flex">
          <div className="shrink-0 flex flex-col" style={{ width: HEADER_W }}>
            {clips.map((clip, i) => (
              <LaneHeader
                key={clip.id}
                name={`Cam ${i + 1}`}
                filename={clip.filename}
                color={clip.color}
                status={camStatusByCamId[clip.id] ?? "off"}
                hotkeyLabel={i < 9 ? String(i + 1) : undefined}
                selected={clip.id === selectedClipId}
                onSelectClip={() => setSelectedClipId(clip.id)}
                onTake={() => addCut({ atTimeS: useEditorStore.getState().playback.currentTime, camId: clip.id })}
                onTakeStart={() => {
                  takeHoldStartRef.current.set(
                    clip.id,
                    useEditorStore.getState().playback.currentTime,
                  );
                }}
                onTakeFinish={() => {
                  const startS = takeHoldStartRef.current.get(clip.id);
                  takeHoldStartRef.current.delete(clip.id);
                  if (startS === undefined) return;
                  const endS = useEditorStore.getState().playback.currentTime;
                  if (Math.abs(endS - startS) > 0.05) {
                    overwriteCutsRange(clip.id, startS, endS);
                  }
                }}
                height={videoLaneHeight}
              />
            ))}
            {/* MASTER · AUDIO header */}
            <div
              className="shrink-0 flex items-center px-3 border-r border-t border-rule bg-paper-hi"
              style={{ height: audioLaneHeight }}
            >
              <span className="font-mono text-[9px] tracking-label uppercase text-ink-2">
                MASTER · AUDIO
              </span>
            </div>
          </div>
          <div className="flex-1 relative" style={{ width: canvasWidth }}>
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

        {/* Custom scrollbar — hardware mixer fader feel */}
        <div className="flex">
          <div
            className="shrink-0 border-r border-t border-rule bg-paper-hi"
            style={{ width: HEADER_W, height: SCROLLBAR_H }}
          />
          <div
            onPointerDown={onScrollPointerDown}
            onPointerMove={onScrollPointerMove}
            onPointerUp={onScrollPointerUp}
            onPointerCancel={onScrollPointerUp}
            className="flex-1 relative border-t border-rule"
            style={{
              width: canvasWidth,
              height: SCROLLBAR_H,
              touchAction: "none",
              cursor: scrollbarVisible ? "pointer" : "default",
              background:
                "linear-gradient(180deg, #C9BFA6 0%, #DDD4BE 50%, #C9BFA6 100%)",
              boxShadow: "inset 0 1px 2px rgba(0,0,0,0.18)",
            }}
          >
            {/* Tick row in the track for a fader-rail feel */}
            <div className="absolute inset-y-[3px] left-0 right-0 flex items-center justify-between pointer-events-none">
              {Array.from({ length: 24 }).map((_, i) => (
                <span
                  key={i}
                  className="w-px h-[6px] block"
                  style={{ background: "rgba(0,0,0,0.18)" }}
                />
              ))}
            </div>
            <div
              className="absolute top-[2px] bottom-[2px] rounded-sm transition-opacity"
              style={{
                left: thumbX,
                width: thumbW,
                background:
                  "linear-gradient(180deg, #FAF6EC 0%, #DDD4BE 50%, #C9BFA6 100%)",
                boxShadow:
                  "inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.15), 0 1px 2px rgba(0,0,0,0.12)",
                opacity: scrollbarVisible ? 1 : 0,
                pointerEvents: scrollbarVisible ? "auto" : "none",
              }}
            >
              {/* Knurled grip lines on the thumb */}
              <span
                className="absolute inset-y-1 left-1/2 -translate-x-1/2 flex gap-[1px]"
                style={{ width: 14 }}
              >
                {Array.from({ length: 5 }).map((_, i) => (
                  <span
                    key={i}
                    className="w-[1px] h-full block"
                    style={{ background: "rgba(0,0,0,0.22)" }}
                  />
                ))}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---- helpers ----

interface DrawVideoLaneArgs {
  ctx: CanvasRenderingContext2D;
  clip: VideoClip;
  bandTop: number;
  bandH: number;
  canvasWidth: number;
  viewStart: number;
  visibleDur: number;
  img: HTMLImageElement | null;
  aspect: number;
  selected: boolean;
}

function drawVideoLane({
  ctx,
  clip,
  bandTop,
  bandH,
  canvasWidth,
  viewStart,
  visibleDur,
  img,
  aspect,
  selected,
}: DrawVideoLaneArgs) {
  // Lane background — paper-deep, same as canvas BG, so video lanes feel
  // continuous and the audio lane reads as the contrasting band below.
  ctx.fillStyle = "#E8E1D0"; // paper-deep
  ctx.fillRect(0, bandTop, canvasWidth, bandH);

  // Clip range on the master timeline.
  const range = clipRangeS(clip);
  const xStart = ((range.startS - viewStart) / visibleDur) * canvasWidth;
  const xEnd = ((range.endS - viewStart) / visibleDur) * canvasWidth;
  if (xEnd <= 0 || xStart >= canvasWidth) return;
  const pillX = Math.max(0, xStart);
  const pillW = Math.min(canvasWidth, xEnd) - pillX;
  if (pillW <= 0) return;

  // Thumbnails — only inside the clip's pill region, with target tile width.
  if (img && img.width > 0 && img.height > 0) {
    const sourceTileW = img.height * aspect;
    const tilesShown = Math.max(2, Math.round(pillW / TARGET_TILE_W));
    const tileWDest = pillW / tilesShown;
    const inset = 4; // padding inside pill so the rounded corners look clean
    const drawTop = bandTop + inset;
    const drawH = bandH - inset * 2;
    ctx.save();
    // Round-rect clip so thumbnails respect the pill boundaries.
    roundRectPath(ctx, pillX, bandTop + 2, pillW, bandH - 4, 6);
    ctx.clip();
    for (let i = 0; i < tilesShown; i++) {
      const tFrac = (i + 0.5) / tilesShown; // sample mid-tile
      const tInClip = range.startS + tFrac * (range.endS - range.startS);
      const sourceFrac = (tInClip - range.startS) / (range.endS - range.startS);
      const sx = Math.max(0, Math.min(img.width - sourceTileW, sourceFrac * img.width - sourceTileW / 2));
      ctx.drawImage(
        img,
        sx,
        0,
        sourceTileW,
        img.height,
        pillX + i * tileWDest,
        drawTop,
        tileWDest,
        drawH,
      );
    }
    ctx.restore();
  }

  // Pill border + cam-color tint overlay (very subtle so thumbs stay visible).
  ctx.save();
  roundRectPath(ctx, pillX + 0.5, bandTop + 2.5, Math.max(0, pillW - 1), bandH - 5, 6);
  ctx.fillStyle = hexToRgba(clip.color, 0.1);
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? clip.color : hexToRgba(clip.color, 0.6);
  ctx.stroke();
  if (selected) {
    // Inner glow.
    ctx.shadowColor = hexToRgba(clip.color, 0.5);
    ctx.shadowBlur = 6;
    ctx.stroke();
  }
  ctx.restore();

  // Top color stripe — strong cam-color tab so the lane is identifiable
  // even when the pill is compressed.
  ctx.fillStyle = clip.color;
  ctx.fillRect(pillX, bandTop, pillW, 3);
}

function drawHandle(ctx: CanvasRenderingContext2D, x: number, top: number, h: number) {
  ctx.fillStyle = "#1A1816";
  ctx.fillRect(x - 1, top, 2, h);
  ctx.fillRect(x - 6, top, 12, 8);
  ctx.fillRect(x - 6, top + h - 8, 12, 8);
  ctx.fillStyle = "#F2EDE2";
  ctx.fillRect(x - 1, top + 2, 2, 4);
  ctx.fillRect(x - 1, top + h - 6, 2, 4);
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function hexToRgba(hex: string, alpha: number): string {
  const c = hex.replace("#", "");
  if (c.length !== 6) return `rgba(0,0,0,${alpha})`;
  const r = parseInt(c.slice(0, 2), 16);
  const g = parseInt(c.slice(2, 4), 16);
  const b = parseInt(c.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
