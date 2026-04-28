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
  MatchCandidate,
  TextOverlay,
  VideoClip,
  VisualizerConfig,
  clipRangeS,
} from "./types";
import { LoopRegion, clampLoopRegion } from "./OffsetScheduler";
import { activeCamAt, type CamRange } from "./cuts";
import { snapTime, type SnapMode } from "./snap";
import { buildQuantizePreview, type QuantizePreview } from "./quantize";
import type { Cut } from "../storage/jobs-db";

export interface BpmInfo {
  /** BPM (detected or user-overridden). */
  value: number;
  /** Detection confidence 0..1 (the autocorrelation peak strength). */
  confidence: number;
  /** Phase of beat 0 in seconds. */
  phase: number;
  /** True when the user manually overrode the detected BPM. */
  manualOverride: boolean;
}

export interface JobMeta {
  id: string;
  fps: number;
  duration: number;
  width: number;
  height: number;
  algoOffsetMs: number;
  driftRatio: number;
  /** Master-audio tempo info — either the detected one or the user's
   *  manual override (manualOverride flag distinguishes). null when no
   *  analysis ran. */
  bpm?: BpmInfo | null;
  /** Original detected BPM (kept around so the user can revert from a
   *  manual override). null when the analysis didn't detect anything. */
  detectedBpm?: BpmInfo | null;
  /** Beat times (seconds, master-timeline). Used by BeatRuler and snap. */
  beats?: number[];
  /** Every 4th beat (4/4 fixed in V1). */
  downbeats?: number[];
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
  /** Active snap mode for every time-mutating drag/click in the timeline. */
  snapMode: SnapMode;
  /** When true, cam-clip horizontal drag is disabled — only the playhead
   *  moves. Avoids the "playhead trapped behind dense clips" problem. */
  lanesLocked: boolean;
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
  /** Top-K alternative offsets from the WASM matcher. Optional — falls back
   *  to a single-element array containing just the primary offset. */
  candidates?: MatchCandidate[];
  /** Persisted user-selected primary candidate index. Defaults to 0. */
  selectedCandidateIdx?: number;
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
   * range. `priorCuts` is the cuts-snapshot at press-time, used by
   * `cancelHold` (Esc) to revert. Cleared back to null on release. */
  holdGesture:
    | { camId: string; startS: number; painting: boolean; priorCuts: Cut[] }
    | null;

  /** Transient preview of the Q-hold quantize gesture. Non-null while
   *  Q is held; rendered as ghost markers in the timeline. Committed on
   *  Q-up via `commitQuantizePreview`, dropped on Esc via `cancelQuantizePreview`. */
  quantizePreview: QuantizePreview | null;

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
  setSnapMode(m: SnapMode): void;
  setLanesLocked(locked: boolean): void;
  /** Reset a cam's alignment back to the algorithm's primary candidate:
   *  selectedCandidateIdx=0, syncOverrideMs=0, startOffsetS=0. Used by
   *  the lane-header ↺ button when the user wants to undo their nudges. */
  resetClipAlignment(camId: string): void;
  setBpm(patch: { value: number; manualOverride: boolean; phase?: number; confidence?: number }): void;
  /** Restore bpm to whatever was originally detected by the analysis
   *  (clears manualOverride). No-op if nothing was detected. */
  resetBpmToDetected(): void;
  setSelectedCandidateIdx(camId: string, idx: number): void;

  // ---- Multi-cam actions ----
  setSelectedClipId(id: string | null): void;
  setClipSyncOverride(camId: string, ms: number): void;
  nudgeClipSyncOverride(camId: string, deltaMs: number): void;
  setClipStartOffset(camId: string, startOffsetS: number): void;
  /** Add a cut, but skip if the target cam is already active at that time
   * (no point recording a switch to the cam that was already on PROGRAM).
   * Returns true if a cut was actually inserted. */
  addCut(cut: Cut): boolean;
  /** Drag-move an existing cut from `fromAtTimeS` to `toAtTimeS` on the
   *  same cam. Returns the time the cut actually landed on (callers may
   *  want to use it as the new identity for the next drag tick). No-op
   *  if the source cut isn't found. */
  moveCut(fromAtTimeS: number, camId: string, toAtTimeS: number): number;
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
  /** UI-only: announce that a TAKE button / hotkey is being held. Snapshots
   *  the current cuts so a subsequent cancelHold can revert. */
  beginHoldGesture(camId: string, startS: number): void;
  /** Promote the active hold to "painting" once the 500 ms threshold passes. */
  promoteHoldToPaint(): void;
  /** Release: clear the indicator. The cuts mutation is done separately. */
  endHoldGesture(): void;
  /** Cancel an active hold and revert cuts to the snapshot taken at
   *  beginHoldGesture. Triggered by Esc during a press. No-op when no
   *  hold is active. */
  cancelHold(): void;

  /** Build a quantize preview from current cuts/clips/trim against the
   *  active snap-mode. Called on Q-down. Re-call to refresh after the
   *  snap-mode changed during the hold. */
  buildAndStartQuantizePreview(): void;
  /** Commit the active preview into the store (mutates cuts, clips, trim).
   *  Called on Q-up. No-op if no preview is active. */
  commitQuantizePreview(): void;
  /** Drop the active preview without applying. Called on Esc during hold. */
  cancelQuantizePreview(): void;

  // ---- Selectors ----
  totalOffsetMs(): number;
  buildEditSpec(): EditSpec;
  camRanges(): CamRange[];
  activeCamId(t?: number): string | null;
  /** Apply the active snap mode to a master-timeline time. Used by every
   *  cut-set call site (TAKE-button, hotkey, REC) so cuts respect the
   *  same grid as drag-snapping. Returns `t` unchanged in mode "off". */
  snapMasterTime(t: number): number;
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
  snapMode: "off",
  // Default: lanes locked. The user has to press the LOCK button to unlock
  // before clips become draggable — keeps the playhead reachable through
  // dense lanes by default. Pressing the (unlock) button = lanes locked
  // becomes false.
  lanesLocked: true,
};

/** True if `camId` has material at master-timeline time `t`. */
function camHasMaterialAt(
  camId: string,
  t: number,
  ranges: readonly CamRange[],
): boolean {
  const r = ranges.find((x) => x.id === camId);
  return !!r && t >= r.startS && t < r.endS;
}

function buildClips(inits: ClipInit[] | undefined, fallbackOverrideMs: number): VideoClip[] {
  if (!inits || inits.length === 0) return [];
  return inits.map((init, i) => {
    const candidates = init.candidates ?? [];
    const selectedIdx = Math.max(
      0,
      Math.min(init.selectedCandidateIdx ?? 0, Math.max(0, candidates.length - 1)),
    );
    // syncOffsetMs mirrors the active candidate when present, otherwise
    // falls back to whatever the caller passed (legacy single-offset path).
    const syncOffsetMs = candidates.length > 0
      ? candidates[selectedIdx].offsetMs
      : init.syncOffsetMs;
    return {
      id: init.id,
      filename: init.filename,
      color: init.color,
      sourceDurationS: init.sourceDurationS,
      syncOffsetMs,
      syncOverrideMs:
        init.syncOverrideMs ?? (i === 0 ? fallbackOverrideMs : 0),
      startOffsetS: init.startOffsetS ?? 0,
      candidates,
      selectedCandidateIdx: selectedIdx,
    };
  });
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
    quantizePreview: null,

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
        quantizePreview: null,
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
      // Normalize bpm/beats/downbeats so consumers can rely on null vs. value
      // instead of having to handle undefined.
      // If the caller didn't pass detectedBpm but did pass an
      // auto-detected bpm (manualOverride === false), treat that as the
      // detected reference. Lets simple test/loader call sites get away
      // with one field instead of two.
      const detectedFallback =
        meta.detectedBpm !== undefined
          ? meta.detectedBpm
          : meta.bpm && !meta.bpm.manualOverride
            ? meta.bpm
            : null;
      const normalizedMeta: JobMeta = {
        ...meta,
        bpm: meta.bpm ?? null,
        detectedBpm: detectedFallback,
        beats: meta.beats ?? [],
        downbeats: meta.downbeats ?? [],
      };
      set({
        jobMeta: normalizedMeta,
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
    setSnapMode(m) {
      set({ ui: { ...get().ui, snapMode: m } });
    },
    setLanesLocked(locked) {
      set({ ui: { ...get().ui, lanesLocked: locked } });
    },
    resetClipAlignment(camId) {
      const clips = get().clips.map((c) => {
        if (c.id !== camId) return c;
        const primary = c.candidates[0];
        return {
          ...c,
          syncOverrideMs: 0,
          startOffsetS: 0,
          selectedCandidateIdx: 0,
          syncOffsetMs: primary?.offsetMs ?? c.syncOffsetMs,
        };
      });
      set({ clips });
      // Mirror cam-1 into the legacy offset slice (SyncTuner).
      if (clips[0]?.id === camId) {
        set({ offset: { ...get().offset, userOverrideMs: 0 } });
      }
    },
    setBpm(patch) {
      const meta = get().jobMeta;
      if (!meta) return;
      const cur = meta.bpm ?? null;
      const next: BpmInfo = {
        value: patch.value,
        confidence: patch.confidence ?? cur?.confidence ?? 0,
        phase: patch.phase ?? cur?.phase ?? 0,
        manualOverride: patch.manualOverride,
      };
      set({ jobMeta: { ...meta, bpm: next } });
    },
    resetBpmToDetected() {
      const meta = get().jobMeta;
      if (!meta?.detectedBpm) return;
      set({
        jobMeta: {
          ...meta,
          bpm: { ...meta.detectedBpm, manualOverride: false },
        },
      });
    },
    setSelectedCandidateIdx(camId, idx) {
      const clips = get().clips.map((c) => {
        if (c.id !== camId) return c;
        const max = Math.max(0, c.candidates.length - 1);
        const clamped = Math.max(0, Math.min(idx, max));
        const newOffset = c.candidates[clamped]?.offsetMs ?? c.syncOffsetMs;
        return { ...c, selectedCandidateIdx: clamped, syncOffsetMs: newOffset };
      });
      set({ clips });
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
      // No-op guard #1: if the cam is already active at this time (via a
      // prior cut or default-fallback), inserting another marker to the
      // same cam is redundant.
      const currentActive = get().activeCamId(cut.atTimeS);
      if (currentActive === cut.camId) return false;

      // No-op guard #2: if the target cam has NO material at this time,
      // adding the cut wouldn't change anything — activeCamAt would still
      // fall back to whatever cam has material here. This is the "single-
      // video area" case: in a region only cam-2 covers, hitting TAKE on
      // cam-1 used to deposit a marker that did nothing.
      const ranges = get().camRanges();
      const target = ranges.find((r) => r.id === cut.camId);
      if (
        !target ||
        cut.atTimeS < target.startS ||
        cut.atTimeS >= target.endS
      ) {
        return false;
      }

      // Replace any cut at exactly the same instant on the same cam (idempotent).
      const existing = get().cuts.filter(
        (c) => !(c.atTimeS === cut.atTimeS && c.camId === cut.camId),
      );
      const next = [...existing, cut].sort((a, b) => a.atTimeS - b.atTimeS);
      set({ cuts: next });
      return true;
    },
    moveCut(fromAtTimeS, camId, toAtTimeS) {
      const cuts = get().cuts;
      const idx = cuts.findIndex(
        (c) => c.atTimeS === fromAtTimeS && c.camId === camId,
      );
      if (idx < 0) return fromAtTimeS;
      // Clamp to the duration window so a drag can't push a cut past
      // the end of the master timeline.
      const dur = get().jobMeta?.duration ?? Infinity;
      const clamped = Math.max(0, Math.min(dur, toAtTimeS));
      // Replace, then re-sort. We don't dedupe during drag — collisions
      // (two cuts collapsing onto the same instant) are easier to
      // resolve visually after the user drops, and silently dropping
      // markers mid-drag would feel like a bug.
      const next = cuts.map((c, i) =>
        i === idx ? { ...c, atTimeS: clamped } : c,
      );
      next.sort((a, b) => a.atTimeS - b.atTimeS);
      set({ cuts: next });
      return clamped;
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
      // Same guard as addCut: only emit the in-marker when the held cam
      // actually has material at lo. Otherwise the marker is visually
      // inert (activeCamAt falls back to whoever else covers the spot).
      if (activeAtLo !== camId && camHasMaterialAt(camId, lo, ranges)) {
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
      // already active at lo AND it actually has material there.
      let next: Cut[] = priorCuts.filter((c) => c.atTimeS < lo || c.atTimeS > hi);
      const activeAtLo = activeCamAt(next, lo, ranges);
      if (activeAtLo !== camId && camHasMaterialAt(camId, lo, ranges)) {
        next.push({ atTimeS: lo, camId });
      }

      // Trailing resume cut at hi — only if the original would have shown
      // a different cam there. activeCamAt only returns a cam that has
      // material, so the trailing cut already targets a valid spot.
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
      // Snapshot cuts at press time — used by cancelHold (Esc) to revert
      // the immediate addCut and any paint-overwrite that was applied
      // during the hold.
      const priorCuts = get().cuts.slice();
      set({ holdGesture: { camId, startS, painting: false, priorCuts } });
    },
    promoteHoldToPaint() {
      const cur = get().holdGesture;
      if (!cur || cur.painting) return;
      set({ holdGesture: { ...cur, painting: true } });
    },
    endHoldGesture() {
      set({ holdGesture: null });
    },
    cancelHold() {
      const cur = get().holdGesture;
      if (!cur) return;
      // Revert to the snapshot — drops the immediate cut AND any paint.
      set({ cuts: cur.priorCuts, holdGesture: null });
    },
    buildAndStartQuantizePreview() {
      const s = get();
      const preview = buildQuantizePreview(
        { cuts: s.cuts, clips: s.clips, trim: s.trim },
        s.ui.snapMode,
        {
          bpm: s.jobMeta?.bpm?.value ?? null,
          beatPhase: s.jobMeta?.bpm?.phase ?? 0,
        },
      );
      set({ quantizePreview: preview });
    },
    commitQuantizePreview() {
      const preview = get().quantizePreview;
      if (!preview) return;
      // Apply cuts: replace each off-grid cut with its snapped target.
      let nextCuts = get().cuts.slice();
      for (const change of preview.cuts) {
        nextCuts = nextCuts.map((c) =>
          c.atTimeS === change.from && c.camId === change.camId
            ? { ...c, atTimeS: change.to }
            : c,
        );
      }
      nextCuts.sort((a, b) => a.atTimeS - b.atTimeS);
      // Dedupe cuts that quantize onto the same instant. Two markers can
      // collapse onto a single grid line in two flavours:
      //   1. Same camId, same time → exact dupe; drop one, no semantics
      //      change (activeCamAt is identical).
      //   2. Different camIds, same time → ambiguity. activeCamAt picks
      //      whichever cut is *later* in the array; the earlier one is
      //      dead. We keep the later one (matches activeCamAt) and drop
      //      the dead one so the user doesn't end up with stacked
      //      markers in the strip.
      // We walk forwards keeping the *latest* cut per atTimeS.
      const TOL = 1e-6;
      const dedupedReverse: Cut[] = [];
      const seenTimes = new Set<number>();
      for (let i = nextCuts.length - 1; i >= 0; i--) {
        const c = nextCuts[i];
        // Use the rounded time as the key so floating-point noise doesn't
        // hide a true dupe.
        const key = Math.round(c.atTimeS / TOL) * TOL;
        if (seenTimes.has(key)) continue;
        seenTimes.add(key);
        dedupedReverse.push(c);
      }
      nextCuts = dedupedReverse.reverse();

      // Apply clip start-offsets.
      const nextClips = get().clips.map((c) => {
        const change = preview.clipStartOffsets.find((p) => p.camId === c.id);
        return change ? { ...c, startOffsetS: change.to } : c;
      });

      // Apply trim.
      const nextTrim = preview.trim ? preview.trim.to : get().trim;

      set({
        cuts: nextCuts,
        clips: nextClips,
        trim: nextTrim,
        quantizePreview: null,
      });
    },
    cancelQuantizePreview() {
      set({ quantizePreview: null });
    },

    totalOffsetMs() {
      // Read the current cam-0 sync from the clips array so that MATCH
      // mode candidate switches (which mutate clips[0].syncOffsetMs) and
      // drag re-syncs (which mutate clips[0].syncOverrideMs) both flow
      // through to the audio scheduler. jobMeta.algoOffsetMs is now a
      // historical field, kept only as a fallback when clips are empty.
      const { clips, jobMeta, offset } = get();
      const cam0 = clips[0];
      const algo = cam0?.syncOffsetMs ?? jobMeta?.algoOffsetMs ?? 0;
      const override = cam0?.syncOverrideMs ?? offset.userOverrideMs;
      return offset.abBypass ? algo : algo + override;
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
    snapMasterTime(t) {
      const s = get();
      const mode = s.ui.snapMode;
      // MATCH mode is for clip-drag (where we have candidatePositions);
      // for cut-set we treat it as off — the user's intent is "snap to
      // beat", not "snap to a cam-alignment offset which is unrelated to
      // the master-clock cut position".
      if (mode === "off" || mode === "match") return t;
      return snapTime(t, mode, {
        bpm: s.jobMeta?.bpm?.value ?? null,
        beatPhase: s.jobMeta?.bpm?.phase ?? 0,
      });
    },
  })),
);
