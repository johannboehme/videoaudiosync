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
import { EditSpec, ExportSpec, TextOverlay, VisualizerConfig } from "../api";
import { LoopRegion, clampLoopRegion } from "./OffsetScheduler";

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
  video_bitrate_kbps: 5000,
  audio_bitrate_kbps: 128,
};

interface EditorState {
  jobMeta: JobMeta | null;
  playback: PlaybackSlice;
  offset: OffsetSlice;
  trim: TrimRegion;
  overlays: TextOverlay[];
  visualizer: VisualizerConfig | null;
  exportSpec: ExportSpec;
  ui: UiSlice;

  // actions
  reset(): void;
  loadJob(meta: JobMeta, opts?: { lastSyncOverrideMs?: number | null }): void;

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

  totalOffsetMs(): number;
  buildEditSpec(): EditSpec;
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
      });
    },

    loadJob(meta, opts) {
      set({
        jobMeta: meta,
        playback: initialPlayback,
        offset: {
          userOverrideMs: opts?.lastSyncOverrideMs ?? 0,
          abBypass: false,
        },
        trim: { in: 0, out: meta.duration },
        overlays: [],
        visualizer: null,
        exportSpec: DEFAULT_EXPORT,
        ui: initialUi,
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
      set({ offset: { ...get().offset, userOverrideMs: ms } });
    },
    nudgeOffset(deltaMs) {
      const cur = get().offset.userOverrideMs;
      // Round to 1 ms for the integer-step nudges, but allow callers to pass
      // sub-ms for the knob (we'll add that later).
      const next = Math.round((cur + deltaMs) * 1000) / 1000;
      set({ offset: { ...get().offset, userOverrideMs: next } });
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
  })),
);
