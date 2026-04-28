/**
 * Editor state. zustand because:
 *  - currentTime updates at ~60Hz; we don't want a useReducer/Context to
 *    re-render the whole tree on every tick. Selectors keep the timeline
 *    and transport bar isolated from panel re-renders.
 *  - Slices are kept logically grouped (offset / trim / etc.) for
 *    extensibility — future tracks/clips slot in without restructuring.
 */
import { create } from "zustand";
import { subscribeWithSelector } from "zustand/middleware";
import {
  EditSpec,
  ExportSpec,
  TextOverlay,
  VideoClip,
  VisualizerConfig,
  clipRangeS,
} from "./types";
import { LoopRegion, clampLoopRegion } from "./OffsetScheduler";
import { activeCamAt, type CamRange } from "./cuts";
import type { Cut } from "../storage/jobs-db";

export interface JobMeta {
  id: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  algoOffsetMs: number;
  driftRatio: number;
}

export type PanelTab = "sync" | "trim" | "overlays" | "export";

export interface PlaybackSlice {
  currentTime: number;
  isPlaying: boolean;
  loop: LoopRegion | null;
  // Set by seek(t); VideoCanvas watches this and writes video.currentTime,
  // then calls clearSeekRequest. Distinguishes user-initiated seeks from the
  // 60Hz tick that mirrors the video's clock back into the store.
  seekRequest: number | null;
}

export interface OffsetSlice {
  userOverrideMs: number;
  // True while the user is comparing original (algo offset only) against the
  // override. Frontends use this to drive the audio scheduler — we play the
  // raw studio audio at algoOffsetMs only when bypass is true.
  abBypass: boolean;
}

export interface TrimRegion {
  in: number;
  out: number;
}

export interface UiSlice {
  activePanel: PanelTab;
  zoom: number; // 1 = full duration fits in viewport, 2 = 50% fits, etc.
  scrollX: number; // seconds offset from start of trim region
}

const DEFAULT_EXPORT: ExportSpec = {
  preset: "web",
  format: "mp4",
  resolution: "source",
  video_codec: "h264",
  audio_codec: "aac",
  video_bitrate_kbps: 3500,
  audio_bitrate_kbps: 128,
  quality: "good",
};

/** Initial-bare data needed to construct in-memory clips when loading a job. */
export interface ClipInit {
  id: string;
  filename: string;
  color: string;
  sourceDurationS: number;
  syncOffsetMs: number;
  syncOverrideMs?: number;
  startOffsetS?: number;
}

interface EditorState {
  jobMeta: JobMeta | null;
  playback: PlaybackSlice;
  offset: OffsetSlice;
  trim: TrimRegion;
  overlays: TextOverlay[];
  visualizer: VisualizerConfig | null;
  exportSpec: ExportSpec;
  ui: UiSlice;

  // ---- Multi-cam ----
  clips: VideoClip[];
  cuts: Cut[];
  selectedClipId: string | null;
  /** Live indicator for an in-progress TAKE-button-or-hotkey hold. While
   * a key/button is pressed, this points to the held cam + the master-time
   * the press started at. Once the press passes the tap-vs-hold threshold,
   * `painting` flips to true and the PROGRAM strip starts visualising the
   * range. Cleared back to null on release. */
  holdGesture: { camId: string; startS: number; painting: boolean } | null;

  // actions
  reset(): void;
  loadJob(
    meta: JobMeta,
    opts?: {
      lastSyncOverrideMs?: number | null;
      clips?: ClipInit[];
      cuts?: Cut[];
    },
  ): void;

  setCurrentTime(t: number): void;
  setPlaying(playing: boolean): void;
  setLoop(loop: LoopRegion | null): void;
  setAbBypass(bypass: boolean): void;
  seek(t: number): void;
  clearSeekRequest(): void;

  setOffset(ms: number): void;
  nudgeOffset(deltaMs: number): void;

  setTrim(t: TrimRegion): void;

  addOverlay(o: TextOverlay): void;
  updateOverlay(idx: number, patch: Partial<TextOverlay>): void;
  removeOverlay(idx: number): void;

  setVisualizer(v: VisualizerConfig | null): void;
  setExport(patch: Partial<ExportSpec>): void;

  setActivePanel(tab: PanelTab): void;
  setZoom(z: number): void;
  setScrollX(x: number): void;

  // ---- Multi-cam actions ----
  setSelectedClipId(id: string | null): void;
  setClipSyncOverride(camId: string, ms: number): void;
  nudgeClipSyncOverride(camId: string, deltaMs: number): void;
  setClipStartOffset(camId: string, startOffsetS: number): void;
  /** Add a cut, but skip if the target cam is already active at that time
   * (no point recording a switch to the cam that was already on PROGRAM).
   * Returns true if a cut was actually inserted. */
  addCut(cut: Cut): boolean;
  /**
   * Hold-to-overwrite: ensures `camId` is on PROGRAM from `fromS` through
   * `toS`. Inserts a cut at `fromS` (skipped if camId is already active
   * there) AND removes any cuts to OTHER cams in (fromS, toS]. Used by
   * the TAKE-hold and hotkey-hold gestures so a press-and-hold visually
   * "paints" the cam over the held span.
   */
  overwriteCutsRange(camId: string, fromS: number, toS: number): void;
  applyHoldRelease(camId: string, fromS: number, toS: number, priorCuts: Cut[]): void;
  removeCutAt(atTimeS: number, camId?: string): void;
  clearCuts(): void;
  /** UI-only: announce that a TAKE button / hotkey is being held. */
  beginHoldGesture(camId: string, startS: number): void;
  /** Promote the active hold to "painting" once the 500 ms threshold passes. */
  promoteHoldToPaint(): void;
  /** Release: clear the indicator. The cuts mutation is done separately. */
  endHoldGesture(): void;

  // ---- Selectors ----
  totalOffsetMs(): number;
  buildEditSpec(): EditSpec;
  camRanges(): CamRange[];
  activeCamId(t?: number): string | null;
}

const TRIM_EPS = 0.05; // seconds — minimum trim window length

const initialPlayback: PlaybackSlice = {
  currentTime: 0,
  isPlaying: false,
  loop: null,
  seekRequest: null,
};

const initialOffset: OffsetSlice = {
  userOverrideMs: 0,
  abBypass: false,
};

const initialUi: UiSlice = {
  activePanel: "sync",
  zoom: 1,
  scrollX: 0,
};

function buildClips(inits: ClipInit[] | undefined, fallbackOverrideMs: number): VideoClip[] {
  if (!inits || inits.length === 0) return [];
  return inits.map((init, i) => ({
    id: init.id,
    filename: init.filename,
    color: init.color,
    sourceDurationS: init.sourceDurationS,
    syncOffsetMs: init.syncOffsetMs,
    syncOverrideMs:
      init.syncOverrideMs ?? (i === 0 ? fallbackOverrideMs : 0),
    startOffsetS: init.startOffsetS ?? 0,
  }));
}

export const useEditorStore = create<EditorState>()(
  subscribeWithSelector((set, get) => ({
    jobMeta: null,
    playback: initialPlayback,
    offset: initialOffset,
    trim: { in: 0, out: 0 },
    overlays: [],
    visualizer: null,
    exportSpec: DEFAULT_EXPORT,
    ui: initialUi,
    clips: [],
    cuts: [],
    selectedClipId: null,
    holdGesture: null,

    reset() {
      set({
        jobMeta: null,
        playback: initialPlayback,
        offset: initialOffset,
        trim: { in: 0, out: 0 },
        overlays: [],
        visualizer: null,
        exportSpec: DEFAULT_EXPORT,
        ui: initialUi,
        clips: [],
        cuts: [],
        selectedClipId: null,
        holdGesture: null,
      });
    },

    loadJob(meta, opts) {
      const fallbackOverride = opts?.lastSyncOverrideMs ?? 0;
      const clips = buildClips(opts?.clips, fallbackOverride);
      // Mirror cam-1's override into the legacy offset slice so existing
      // OffsetScheduler / SyncTuner consumers see the same number.
      const legacyOverrideMs = clips[0]?.syncOverrideMs ?? fallbackOverride;
      // Auto-select the only cam if there's just one — bequem für Single-Video-Use.
      const selectedClipId = clips.length === 1 ? clips[0].id : null;
      set({
        jobMeta: meta,
        playback: initialPlayback,
        offset: {
          userOverrideMs: legacyOverrideMs,
          abBypass: false,
        },
        trim: { in: 0, out: meta.duration },
        overlays: [],
        visualizer: null,
        exportSpec: DEFAULT_EXPORT,
        ui: initialUi,
        clips,
        cuts: opts?.cuts ?? [],
        selectedClipId,
      });
    },

    setCurrentTime(t) {
      set({ playback: { ...get().playback, currentTime: t } });
    },
    setPlaying(playing) {
      set({ playback: { ...get().playback, isPlaying: playing } });
    },
    setLoop(loop) {
      const { trim } = get();
      const clamped = loop ? clampLoopRegion(loop, trim) : null;
      set({ playback: { ...get().playback, loop: clamped } });
    },
    setAbBypass(bypass) {
      set({ offset: { ...get().offset, abBypass: bypass } });
    },
    seek(t) {
      const meta = get().jobMeta;
      const dur = meta?.duration ?? Infinity;
      const clamped = Math.max(0, Math.min(t, dur));
      set({
        playback: {
          ...get().playback,
          currentTime: clamped,
          seekRequest: clamped,
        },
      });
    },
    clearSeekRequest() {
      set({ playback: { ...get().playback, seekRequest: null } });
    },

    setOffset(ms) {
      // Backward-shim: also writes through to cam-1's override, so the
      // multi-cam clips slice and the legacy offset slice stay in sync.
      set({ offset: { ...get().offset, userOverrideMs: ms } });
      const clips = get().clips;
      if (clips.length > 0) {
        const next = clips.map((c, i) =>
          i === 0 ? { ...c, syncOverrideMs: ms } : c,
        );
        set({ clips: next });
      }
    },
    nudgeOffset(deltaMs) {
      const cur = get().offset.userOverrideMs;
      // Round to 1 ms for the integer-step nudges, but allow callers to pass
      // sub-ms for the knob (we'll add that later).
      const next = Math.round((cur + deltaMs) * 1000) / 1000;
      set({ offset: { ...get().offset, userOverrideMs: next } });
      const clips = get().clips;
      if (clips.length > 0) {
        const updated = clips.map((c, i) =>
          i === 0 ? { ...c, syncOverrideMs: next } : c,
        );
        set({ clips: updated });
      }
    },

    setTrim(t) {
      const meta = get().jobMeta;
      const dur = meta?.duration ?? Infinity;
      let { in: tin, out: tout } = t;
      tin = Math.max(0, Math.min(tin, dur));
      tout = Math.max(0, Math.min(tout, dur));
      if (tout - tin < TRIM_EPS) {
        // degenerate: keep tout fixed, push tin back
        tin = Math.max(0, tout - TRIM_EPS);
      }
      set({ trim: { in: tin, out: tout } });
      // Re-clamp loop to new trim
      const loop = get().playback.loop;
      if (loop) {
        const clamped = clampLoopRegion(loop, { in: tin, out: tout });
        set({ playback: { ...get().playback, loop: clamped } });
      }
    },

    addOverlay(o) {
      set({ overlays: [...get().overlays, o] });
    },
    updateOverlay(idx, patch) {
      set({
        overlays: get().overlays.map((o, i) =>
          i === idx ? { ...o, ...patch } : o,
        ),
      });
    },
    removeOverlay(idx) {
      set({ overlays: get().overlays.filter((_, i) => i !== idx) });
    },

    setVisualizer(v) {
      set({ visualizer: v });
    },
    setExport(patch) {
      set({ exportSpec: { ...get().exportSpec, ...patch } });
    },

    setActivePanel(tab) {
      set({ ui: { ...get().ui, activePanel: tab } });
    },
    setZoom(z) {
      set({ ui: { ...get().ui, zoom: Math.max(1, Math.min(64, z)) } });
    },
    setScrollX(x) {
      set({ ui: { ...get().ui, scrollX: Math.max(0, x) } });
    },

    setSelectedClipId(id) {
      set({ selectedClipId: id });
    },
    setClipSyncOverride(camId, ms) {
      const clips = get().clips.map((c) =>
        c.id === camId ? { ...c, syncOverrideMs: ms } : c,
      );
      set({ clips });
      // Mirror cam-1 changes into legacy offset slice.
      if (clips[0]?.id === camId) {
        set({ offset: { ...get().offset, userOverrideMs: ms } });
      }
    },
    nudgeClipSyncOverride(camId, deltaMs) {
      const cur = get().clips.find((c) => c.id === camId)?.syncOverrideMs ?? 0;
      const next = Math.round((cur + deltaMs) * 1000) / 1000;
      get().setClipSyncOverride(camId, next);
    },
    setClipStartOffset(camId, startOffsetS) {
      const clips = get().clips.map((c) =>
        c.id === camId ? { ...c, startOffsetS } : c,
      );
      set({ clips });
    },
    addCut(cut) {
      // No-op guard: if the cam is already active at this time (either via
      // a prior cut or the default-fallback), inserting another cut to the
      // same cam is meaningless — skip it. Also stops accidental hold-key
      // floods from littering the timeline with redundant markers.
      const currentActive = get().activeCamId(cut.atTimeS);
      if (currentActive === cut.camId) return false;

      // Replace any cut at exactly the same instant on the same cam (idempotent).
      const existing = get().cuts.filter(
        (c) => !(c.atTimeS === cut.atTimeS && c.camId === cut.camId),
      );
      const next = [...existing, cut].sort((a, b) => a.atTimeS - b.atTimeS);
      set({ cuts: next });
      return true;
    },
    overwriteCutsRange(camId, fromS, toS) {
      const lo = Math.min(fromS, toS);
      const hi = Math.max(fromS, toS);
      const cuts = get().cuts;
      // Drop every cut inside [lo, hi] — the held cam painted over them.
      let next = cuts.filter((c) => c.atTimeS < lo || c.atTimeS > hi);
      const ranges = get().clips.map((c) => {
        const r = clipRangeS(c);
        return { id: c.id, startS: r.startS, endS: r.endS };
      });
      const activeAtLo = activeCamAt(next, lo, ranges);
      if (activeAtLo !== camId) {
        next = [...next, { atTimeS: lo, camId }].sort(
          (a, b) => a.atTimeS - b.atTimeS,
        );
      }
      set({ cuts: next });
    },
    applyHoldRelease(camId: string, fromS: number, toS: number, priorCuts: Cut[]) {
      const lo = Math.min(fromS, toS);
      const hi = Math.max(fromS, toS);
      const ranges = get().clips.map((c) => {
        const r = clipRangeS(c);
        return { id: c.id, startS: r.startS, endS: r.endS };
      });
      // What WOULD have been on PROGRAM at the release moment if we hadn't
      // painted? That's the cam we want to resume to (unless it's the cam
      // we were holding, in which case the hold was redundant and no
      // trailing cut is needed).
      const prevActiveAtRelease = activeCamAt(priorCuts, hi, ranges);

      // Paint: drop cuts in [lo, hi], insert lead cut if camId wasn't
      // already active at lo.
      let next: Cut[] = priorCuts.filter((c) => c.atTimeS < lo || c.atTimeS > hi);
      const activeAtLo = activeCamAt(next, lo, ranges);
      if (activeAtLo !== camId) {
        next.push({ atTimeS: lo, camId });
      }

      // Trailing resume cut at hi — only if the original would have shown
      // a different cam there.
      if (prevActiveAtRelease !== null && prevActiveAtRelease !== camId) {
        next.push({ atTimeS: hi, camId: prevActiveAtRelease });
      }

      next.sort((a, b) => a.atTimeS - b.atTimeS);
      set({ cuts: next });
    },
    removeCutAt(atTimeS, camId) {
      const next = get().cuts.filter(
        (c) =>
          c.atTimeS !== atTimeS || (camId !== undefined && c.camId !== camId),
      );
      set({ cuts: next });
    },
    clearCuts() {
      set({ cuts: [] });
    },
    beginHoldGesture(camId: string, startS: number) {
      set({ holdGesture: { camId, startS, painting: false } });
    },
    promoteHoldToPaint() {
      const cur = get().holdGesture;
      if (!cur || cur.painting) return;
      set({ holdGesture: { ...cur, painting: true } });
    },
    endHoldGesture() {
      set({ holdGesture: null });
    },

    totalOffsetMs() {
      const { jobMeta, offset } = get();
      const algo = jobMeta?.algoOffsetMs ?? 0;
      return offset.abBypass ? algo : algo + offset.userOverrideMs;
    },

    buildEditSpec() {
      const s = get();
      return {
        version: 1,
        segments: [{ in: s.trim.in, out: s.trim.out }],
        overlays: s.overlays,
        visualizer: s.visualizer,
        sync_override_ms: s.offset.userOverrideMs,
        export: s.exportSpec,
      };
    },

    camRanges() {
      return get().clips.map((c) => {
        const range = clipRangeS(c);
        return { id: c.id, startS: range.startS, endS: range.endS };
      });
    },
    activeCamId(t) {
      const s = get();
      const time = t ?? s.playback.currentTime;
      const ranges = s.clips.map((c) => {
        const range = clipRangeS(c);
        return { id: c.id, startS: range.startS, endS: range.endS };
      });
      return activeCamAt(s.cuts, time, ranges);
    },
  })),
);
