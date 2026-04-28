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
import { AddMediaButton } from "./AddMediaButton";
import { ProgramStrip } from "./timeline/ProgramStrip";
import { BeatRuler } from "./timeline/BeatRuler";
import { BpmReadout } from "./BpmReadout";
import { SnapModeButtons } from "./SnapModeButtons";
import { snapTime, type SnapCtx, type SnapMode } from "../snap";
import { DEFAULT_MATCH_CONFIDENCE_THRESHOLD } from "../match-snap";

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
  | {
      kind: "clip-move";
      camId: string;
      grabT: number;
      origStartOffsetS: number;
      /** syncOverrideMs at drag-start. Drag mutates this (not
       *  startOffsetS) so the cam's audio/video alignment actually
       *  shifts against the master audio — startOffsetS is purely
       *  visual and would silently desync cam-1's audio. */
      origSyncOverrideMs: number;
      /** Visible master-timeline startS at drag-start. Used to compute
       *  the pointer's intended new startS independently of any
       *  candidate-switch that may happen mid-drag — without it, the
       *  algoSync delta cascades and the user "jumps" past middle
       *  candidates. */
      origStartS: number;
    }
  | { kind: "scrollbar"; offsetX: number };

const HANDLE_HIT = 14;
const TARGET_TILE_W = 64;
const HEADER_W = 156;
const SCROLLBAR_H = 14;

export function Timeline({
  cams,
  peaks,
  audioDuration,
  audioLaneHeight = 48,
  videoLaneHeight = 48,
}: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(800);
  const dragRef = useRef<DragKind | null>(null);
  /** Set during a clip-move drag so the PROGRAM strip can show match
   *  markers only while the user is actually re-aligning a cam. */
  const [activeClipMoveDragId, setActiveClipMoveDragId] = useState<
    string | null
  >(null);
  /** Snapshot of the timeline-range at drag-start. Frozen for the
   *  duration of a clip-move so the canvas doesn't rescale under the
   *  user's cursor — without this freeze, dragging right extends the
   *  range, the pixel-per-second shrinks, and the pill seems to
   *  asymptote to the canvas edge instead of following the pointer. */
  const frozenTimelineRangeRef = useRef<{
    startS: number;
    endS: number;
    span: number;
  } | null>(null);

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
  const setClipSyncOverride = useEditorStore((s) => s.setClipSyncOverride);
  const setSelectedCandidateIdx = useEditorStore((s) => s.setSelectedCandidateIdx);
  const resetClipAlignment = useEditorStore((s) => s.resetClipAlignment);
  const removeCutAt = useEditorStore((s) => s.removeCutAt);
  const currentTime = useEditorStore((s) => s.playback.currentTime);
  const holdGesture = useEditorStore((s) => s.holdGesture);
  const snapMode = useEditorStore((s) => s.ui.snapMode);
  const lanesLocked = useEditorStore((s) => s.ui.lanesLocked);
  const bpm = useEditorStore((s) => s.jobMeta?.bpm?.value ?? null);
  const beatPhase = useEditorStore((s) => s.jobMeta?.bpm?.phase ?? 0);
  const quantizePreview = useEditorStore((s) => s.quantizePreview);
  const takePromoteTimerRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const duration = jobMeta?.duration || audioDuration || 0;
  // The visible/scroll range covers the union of the master audio AND
  // every cam's master-timeline span (incl. their match-marker positions
  // so candidate ticks at negative master-time stay reachable). During
  // an active clip-move drag we *freeze* this range to the snapshot
  // captured at drag-start (`frozenTimelineRangeRef`) — without that
  // freeze, dragging right would extend the range, shrink pxPerSec, and
  // the pill would asymptote to the canvas edge instead of following
  // the pointer.
  const liveTimelineRange = useMemo(() => {
    let lo = 0;
    let hi = duration;
    for (const c of clips) {
      const r = clipRangeS(c);
      if (r.startS < lo) lo = r.startS;
      if (r.endS > hi) hi = r.endS;
      for (const cand of c.candidates) {
        const t = -(cand.offsetMs + c.syncOverrideMs) / 1000;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
    }
    return { startS: lo, endS: hi, span: hi - lo };
  }, [clips, duration]);
  const timelineRange = activeClipMoveDragId && frozenTimelineRangeRef.current
    ? frozenTimelineRangeRef.current
    : liveTimelineRange;
  const timelineStartS = timelineRange.startS;
  const timelineSpan = Math.max(1e-6, timelineRange.span);
  const visibleDur = timelineSpan / zoom;
  // scrollX semantics: offset (≥0) from timelineStartS. We clamp here so
  // a stale scrollX doesn't escape after the range changes (e.g. user
  // drags a cam further left, shrinking timelineStartS).
  const maxScroll = Math.max(0, timelineSpan - visibleDur);
  const clampedScroll = Math.max(0, Math.min(maxScroll, scrollX));
  const viewStart = timelineStartS + clampedScroll;
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
      // Match-point markers: vertical ticks at each candidate's implied
      // start position. Highlighted in MATCH mode; subtle otherwise so the
      // user can see all alternatives the matcher considered.
      drawMatchMarkers({
        ctx,
        clip,
        bandTop: band.top,
        bandH: videoLaneHeight,
        viewStart,
        visibleDur,
        canvasWidth,
        emphasized: snapMode === "match",
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

    // Q-hold quantize preview: ghost markers at the snapped target
    // positions. Drawn last so they overlay every lane.
    if (quantizePreview) {
      ctx.save();
      ctx.fillStyle = "rgba(0, 102, 204, 0.85)"; // cobalt
      ctx.strokeStyle = "rgba(0, 102, 204, 0.85)";
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      for (const change of quantizePreview.cuts) {
        const xTo = tToX(change.to);
        if (xTo < -2 || xTo > canvasWidth + 2) continue;
        ctx.beginPath();
        ctx.moveTo(xTo, 0);
        ctx.lineTo(xTo, canvasH);
        ctx.stroke();
      }
      // Faded "from" line for each off-grid cut (visual hint of the move).
      ctx.strokeStyle = "rgba(0, 0, 0, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 4]);
      for (const change of quantizePreview.cuts) {
        const xFrom = tToX(change.from);
        if (xFrom < -2 || xFrom > canvasWidth + 2) continue;
        ctx.beginPath();
        ctx.moveTo(xFrom, 0);
        ctx.lineTo(xFrom, canvasH);
        ctx.stroke();
      }
      ctx.restore();
    }
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
    snapMode,
    quantizePreview,
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

  // Build the snap context for this drag. `extraCandidates` is set during
  // a clip-move so MATCH mode can snap the cam to its alternative offsets.
  function buildSnapCtx(extraCandidates?: number[]): SnapCtx {
    return {
      bpm,
      beatPhase,
      candidatePositions: extraCandidates,
    };
  }

  // Wrap a raw timeline-time through the active snap mode. Shift-hold
  // bypasses snapping (standard NLE-style anti-snap modifier).
  function snapped(t: number, e: { shiftKey: boolean }, candPositions?: number[]): number {
    if (e.shiftKey || snapMode === "off") return t;
    return snapTime(t, snapMode, buildSnapCtx(candPositions));
  }

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = e.currentTarget;
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const tRaw = xToT(x);

    // Audio lane → existing trim/loop/playhead/seek behavior.
    if (y >= audioBand.top) {
      const k = classifyAudioHit(x);
      if (k === null) {
        seek(snapped(tRaw, e));
        dragRef.current = { kind: "playhead" };
      } else if (k === "trim-in") {
        dragRef.current = { kind: "trim-in" };
      } else if (k === "trim-out") {
        dragRef.current = { kind: "trim-out" };
      } else if (k === "playhead") {
        dragRef.current = { kind: "playhead" };
      } else if (k === "loop" && loop) {
        dragRef.current = { kind: "loop", offset: tRaw - loop.start };
      }
      return;
    }

    // Video lane:
    //   * Locked (default): click anywhere = scrub the playhead (the
    //     playhead can be dragged through dense clips without getting
    //     stuck).
    //   * Unlocked: click on a clip pill = drag-move that clip; click on
    //     empty area = scrub the playhead. Selection always happens.
    const hit = findClipAt(x, y);
    if (hit) {
      setSelectedClipId(hit.clip.id);
      if (!lanesLocked) {
        const r = clipRangeS(hit.clip);
        dragRef.current = {
          kind: "clip-move",
          camId: hit.clip.id,
          grabT: tRaw,
          origStartOffsetS: hit.clip.startOffsetS,
          origSyncOverrideMs: hit.clip.syncOverrideMs,
          origStartS: r.startS,
        };
        // Freeze the timeline range so pxPerSec stays stable through
        // the drag.
        frozenTimelineRangeRef.current = liveTimelineRange;
        setActiveClipMoveDragId(hit.clip.id);
      } else {
        seek(snapped(tRaw, e));
        dragRef.current = { kind: "playhead" };
      }
    } else {
      setSelectedClipId(null);
      seek(snapped(tRaw, e));
      dragRef.current = { kind: "playhead" };
    }
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!dragRef.current) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tRaw = Math.max(0, Math.min(duration, xToT(x)));
    const drag = dragRef.current;
    if (drag.kind === "playhead") {
      seek(snapped(tRaw, e));
    } else if (drag.kind === "trim-in") {
      setTrim({ in: snapped(tRaw, e), out: trim.out });
    } else if (drag.kind === "trim-out") {
      setTrim({ in: trim.in, out: snapped(tRaw, e) });
    } else if (drag.kind === "loop" && loop) {
      const len = loop.end - loop.start;
      const newStartRaw = Math.max(trim.in, Math.min(trim.out - len, tRaw - drag.offset));
      const newStart = snapped(newStartRaw, e);
      setLoop({ start: newStart, end: newStart + len });
    } else if (drag.kind === "clip-move") {
      const c = clips.find((cc) => cc.id === drag.camId);
      if (!c) return;
      // Pointer's intended new clip-startS, computed from the snapshot
      // taken at drag-start. Stable through any candidate-switch that
      // happens mid-drag (which would otherwise jolt algoSyncS and make
      // middle candidates unreachable).
      const targetStartS = drag.origStartS + (xToT(x) - drag.grabT);

      // MATCH mode: always snap to the nearest candidate-implied startS.
      // No distance threshold — every candidate is a valid lock-target.
      // Shift bypasses snapping entirely. We use the orig syncOverrideMs
      // to compute candidate positions, so candidate-switching mid-drag
      // doesn't shift the math under us.
      if (snapMode === "match" && !e.shiftKey && c.candidates.length > 0) {
        type CandPos = { idx: number; startS: number };
        const positions: CandPos[] = c.candidates
          .map((cand, idx) => {
            if (cand.confidence < DEFAULT_MATCH_CONFIDENCE_THRESHOLD) return null;
            const totalMs = cand.offsetMs + drag.origSyncOverrideMs;
            return { idx, startS: -totalMs / 1000 };
          })
          .filter((p): p is CandPos => p !== null);
        if (positions.length > 0) {
          let bestIdx = positions[0].idx;
          let bestDist = Math.abs(positions[0].startS - targetStartS);
          for (let i = 1; i < positions.length; i++) {
            const d = Math.abs(positions[i].startS - targetStartS);
            if (d < bestDist) {
              bestDist = d;
              bestIdx = positions[i].idx;
            }
          }
          if (bestIdx !== c.selectedCandidateIdx) {
            setSelectedCandidateIdx(drag.camId, bestIdx);
          }
          // Keep the user's syncOverrideMs untouched (their fine-tune
          // applies on top of whichever candidate is chosen). Reset
          // startOffsetS so the cam sits exactly on the candidate anchor.
          if (c.syncOverrideMs !== drag.origSyncOverrideMs) {
            setClipSyncOverride(drag.camId, drag.origSyncOverrideMs);
          }
          if (c.startOffsetS !== 0) setClipStartOffset(drag.camId, 0);
          return;
        }
      }

      // Non-MATCH (off / grid): mutate syncOverrideMs so the drag is a
      // *true* sync change. cam1.startS becomes its new value; the
      // VideoCanvas effect compensates by seeking cam-1.video.currentTime
      // so the master-time playhead doesn't visually jump. Cam-2+ re-anchor
      // automatically through their SatelliteCam sourceT computation.
      const targetSnapped = snapped(targetStartS, e);
      // startS = -(syncOffsetMs + syncOverrideMs)/1000 + startOffsetS
      // → syncOverrideMs = -1000*(startS - startOffsetS) - syncOffsetMs
      const newSyncOverrideMs =
        -1000 * (targetSnapped - drag.origStartOffsetS) - c.syncOffsetMs;
      setClipSyncOverride(drag.camId, newSyncOverrideMs);
    }
  };

  const onPointerUp = () => {
    dragRef.current = null;
    setActiveClipMoveDragId(null);
    frozenTimelineRangeRef.current = null;
  };

  // Wheel zoom — anchored at the cursor's master-time. scrollX is
  // expressed as offset (≥0) from the timeline's left edge (= the
  // most-negative cam start, or 0).
  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const tAtCursor = xToT(x);
    const factor = e.deltaY < 0 ? 1.2 : 1 / 1.2;
    const newZoom = Math.max(1, Math.min(64, zoom * factor));
    if (newZoom === zoom) return;
    const newVisible = timelineSpan / newZoom;
    const desiredViewStart = tAtCursor - (x / canvasWidth) * newVisible;
    const newScroll = Math.max(
      0,
      Math.min(timelineSpan - newVisible, desiredViewStart - timelineStartS),
    );
    setZoom(newZoom);
    setScrollX(newScroll);
  };

  // ---- Custom hardware-mixer scrollbar ----
  const scrollbarVisible = zoom > 1.001 && timelineSpan > 0;
  const thumbW = scrollbarVisible
    ? Math.max(28, (visibleDur / timelineSpan) * canvasWidth)
    : canvasWidth;
  const thumbX = scrollbarVisible
    ? ((viewStart - timelineStartS) / timelineSpan) * canvasWidth
    : 0;

  const onScrollPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!scrollbarVisible) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    if (x < thumbX || x > thumbX + thumbW) {
      const newThumbX = Math.max(0, Math.min(canvasWidth - thumbW, x - thumbW / 2));
      setScrollX((newThumbX / canvasWidth) * timelineSpan);
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
    setScrollX((newThumbX / canvasWidth) * timelineSpan);
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
      {/* Top header row: BPM-LCD + cassette snap-buttons on the left,
          view-range readout on the right. The BPM column and the button
          plate are vertically centered to the row's content height. */}
      <div className="flex items-center gap-4 px-1 mb-2">
        <BpmReadout />
        <SnapModeButtons />
        <ActiveMatchReadout
          camId={activeClipMoveDragId}
          snapMode={snapMode}
          clips={clips}
        />
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] tabular text-ink-3 font-mono">
            {zoomPercent}%
          </span>
          <span className="text-[10px] tabular text-ink-3 font-mono">
            {viewStart.toFixed(1)}s — {viewEnd.toFixed(1)}s
          </span>
        </div>
      </div>

      <div className="rounded-md overflow-hidden border border-rule shadow-panel bg-paper-hi-deep">
        {/* Bar/beat ruler row — bars + beats + subdivisions, click to seek. */}
        <div className="flex border-b border-rule">
          <div
            className="shrink-0 flex items-center justify-end px-2 border-r border-rule bg-paper-hi"
            style={{ width: HEADER_W, height: 26 }}
          >
            <span className="font-mono text-[9px] tracking-label uppercase text-ink-3">
              BARS
            </span>
          </div>
          <div className="flex-1" style={{ width: canvasWidth }}>
            <BeatRuler
              contentWidthPx={canvasWidth}
              viewStartS={viewStart}
              viewEndS={viewEnd}
              height={26}
            />
          </div>
        </div>

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
              onCutDrag={(fromAtTimeS, camId, rawNewT, ev) => {
                // Apply the same snap rules as the rest of the timeline:
                // SHIFT bypasses, MATCH falls through (no candidatePositions
                // for cut-set), grid modes round to the nearest beat/bar.
                const snappedT = ev.shiftKey
                  ? rawNewT
                  : useEditorStore.getState().snapMasterTime(rawNewT);
                return useEditorStore
                  .getState()
                  .moveCut(fromAtTimeS, camId, snappedT);
              }}
              paintPreview={(() => {
                if (!holdGesture || !holdGesture.painting) return null;
                const clip = clips.find((c) => c.id === holdGesture.camId);
                if (!clip) return null;
                const idx = clips.findIndex((c) => c.id === clip.id);
                return {
                  fromS: holdGesture.startS,
                  toS: currentTime,
                  color: clip.color,
                  camLabel: `CAM ${idx + 1}`,
                };
              })()}
              matchMarkers={(() => {
                // Show match markers ONLY while the user is actively
                // dragging a clip in MATCH mode — they're an interaction
                // affordance, not a permanent overlay. We render the
                // markers for that one clip (so candidates from other
                // cams don't pollute the view).
                if (snapMode !== "match" || !activeClipMoveDragId) {
                  return undefined;
                }
                const c = clips.find((cc) => cc.id === activeClipMoveDragId);
                if (!c || !c.candidates || c.candidates.length === 0) {
                  return undefined;
                }
                return c.candidates
                  .filter(
                    (cand) =>
                      cand.confidence >= DEFAULT_MATCH_CONFIDENCE_THRESHOLD,
                  )
                  .map((cand) => {
                    const idx = c.candidates.indexOf(cand);
                    const totalMs = cand.offsetMs + c.syncOverrideMs;
                    return {
                      t: -totalMs / 1000,
                      confidence: cand.confidence,
                      isPrimary: idx === c.selectedCandidateIdx,
                    };
                  });
              })()}
            />
          </div>
        </div>

        {/* Lanes row: HTML headers on the left, single canvas on the right.
         *  Wrapped in a max-height + overflow-y container so adding more
         *  cams doesn't push the timeline section into the preview area —
         *  past ~5 cam lanes a vertical scrollbar appears on the right. */}
        <div
          className="flex"
          style={{
            maxHeight: 5 * videoLaneHeight + audioLaneHeight,
            overflowY: "auto",
          }}
        >
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
                pressed={holdGesture?.camId === clip.id}
                painting={
                  holdGesture?.camId === clip.id && holdGesture.painting
                }
                onSelectClip={() => setSelectedClipId(clip.id)}
                // onTake is intentionally omitted — the cassette-rec
                // model fires the immediate cut inside onTakeStart so a
                // tap and a hold use one code path.
                onTakeStart={() => {
                  const s = useEditorStore.getState();
                  // Single-active-hold guard: ignore if another TAKE is
                  // already engaged (button or keyboard).
                  if (s.holdGesture) return;
                  const startS = s.snapMasterTime(s.playback.currentTime);
                  s.beginHoldGesture(clip.id, startS);
                  s.addCut({ atTimeS: startS, camId: clip.id });
                  const existing = takePromoteTimerRef.current.get(clip.id);
                  if (existing) clearTimeout(existing);
                  const t = setTimeout(() => {
                    useEditorStore.getState().promoteHoldToPaint();
                  }, 500);
                  takePromoteTimerRef.current.set(clip.id, t);
                }}
                onTakeFinish={() => {
                  const promoteT = takePromoteTimerRef.current.get(clip.id);
                  if (promoteT) {
                    clearTimeout(promoteT);
                    takePromoteTimerRef.current.delete(clip.id);
                  }
                  const s2 = useEditorStore.getState();
                  const hold = s2.holdGesture;
                  // Only act on releases that match this clip's hold —
                  // otherwise a stale onTakeFinish (after a cancelHold
                  // via Esc) shouldn't re-apply anything.
                  if (!hold || hold.camId !== clip.id) return;
                  const endS = s2.snapMasterTime(s2.playback.currentTime);
                  if (hold.painting) {
                    s2.applyHoldRelease(
                      clip.id,
                      hold.startS,
                      endS,
                      hold.priorCuts,
                    );
                  }
                  s2.endHoldGesture();
                }}
                canReset={
                  clip.syncOverrideMs !== 0 ||
                  clip.startOffsetS !== 0 ||
                  clip.selectedCandidateIdx !== 0
                }
                onReset={() => resetClipAlignment(clip.id)}
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
            {/* + Media — append cams + B-roll without leaving the editor */}
            {jobMeta?.id && (
              <AddMediaButton jobId={jobMeta.id} width={HEADER_W} />
            )}
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

interface DrawMatchMarkersArgs {
  ctx: CanvasRenderingContext2D;
  clip: VideoClip;
  bandTop: number;
  bandH: number;
  viewStart: number;
  visibleDur: number;
  canvasWidth: number;
  emphasized: boolean;
}

/** Render small ticks at each candidate-implied start position. The
 *  active candidate is rendered as a chunky filled triangle, alternates
 *  as thinner ticks fading out with confidence. In MATCH mode the alts
 *  brighten so the user can aim at them while dragging. */
function drawMatchMarkers({
  ctx,
  clip,
  bandTop,
  bandH,
  viewStart,
  visibleDur,
  canvasWidth,
  emphasized,
}: DrawMatchMarkersArgs) {
  if (!clip.candidates || clip.candidates.length === 0) return;
  ctx.save();
  for (let i = 0; i < clip.candidates.length; i++) {
    const c = clip.candidates[i];
    const totalMs = c.offsetMs + clip.syncOverrideMs;
    const startS = -totalMs / 1000 + clip.startOffsetS;
    const x = ((startS - viewStart) / visibleDur) * canvasWidth;
    if (x < -8 || x > canvasWidth + 8) continue;
    const isPrimary = i === clip.selectedCandidateIdx;
    const conf = Math.max(0, Math.min(1, c.confidence));
    const baseOpacity = (isPrimary ? 1 : 0.35) * (emphasized ? 1 : 0.55);
    const opacity = baseOpacity * (0.4 + 0.6 * conf);
    const tickW = isPrimary ? 3 : 2;
    const tickH = isPrimary ? bandH - 6 : Math.round(bandH * 0.45);
    ctx.fillStyle = `rgba(255,87,34,${opacity})`; // hot
    ctx.fillRect(Math.floor(x), bandTop + 2, tickW, tickH);
    if (isPrimary) {
      // Filled inverted triangle on top to mark the active alignment.
      ctx.beginPath();
      ctx.moveTo(x - 4, bandTop);
      ctx.lineTo(x + 4, bandTop);
      ctx.lineTo(x, bandTop + 6);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
}

/** Big "currently snapped to" readout that lights up only while a
 *  clip-move drag is active in MATCH mode. Mirrors the heatmap colour
 *  used by the markers themselves so the user can correlate them, and
 *  shows the percentage in big LCD-ish digits so they can decide
 *  whether to commit or keep dragging without staring at tiny numbers
 *  on the strip. */
function ActiveMatchReadout({
  camId,
  snapMode,
  clips,
}: {
  camId: string | null;
  snapMode: SnapMode;
  clips: VideoClip[];
}) {
  if (!camId || snapMode !== "match") return null;
  const clip = clips.find((c) => c.id === camId);
  if (!clip || clip.candidates.length === 0) return null;
  const cand = clip.candidates[clip.selectedCandidateIdx];
  if (!cand) return null;
  const conf = Math.max(0, Math.min(1, cand.confidence));
  const hue = Math.pow(conf, 2.2) * 135;
  const sat = 70 + 25 * conf;
  const light = 38 + 18 * conf;
  const color = `hsl(${hue.toFixed(1)}, ${sat.toFixed(1)}%, ${light.toFixed(1)}%)`;
  const pct = Math.round(conf * 100);
  return (
    <div
      className="flex flex-col items-start"
      style={{
        background: "linear-gradient(180deg, #1A1612 0%, #0E0B08 100%)",
        boxShadow: [
          "inset 0 1px 0 rgba(255,255,255,0.08)",
          "inset 0 -1px 0 rgba(0,0,0,0.5)",
          "inset 0 0 12px rgba(0,0,0,0.55)",
          "0 1px 0 rgba(255,255,255,0.5)",
        ].join(", "),
        borderRadius: 6,
        padding: "3px 10px 4px",
        minWidth: 86,
      }}
    >
      <span
        className="font-display text-[8px] tracking-[0.2em] uppercase leading-none"
        style={{ color: "rgba(255,255,255,0.55)" }}
      >
        MATCH
      </span>
      <div className="flex items-baseline gap-1">
        <span
          className="font-mono tabular leading-none"
          style={{
            color,
            textShadow: `0 0 6px ${color}`,
            fontSize: 22,
            fontWeight: 700,
          }}
        >
          {pct}
        </span>
        <span
          className="font-mono leading-none"
          style={{
            color: "rgba(255,255,255,0.5)",
            fontSize: 10,
          }}
        >
          %
        </span>
      </div>
    </div>
  );
}
