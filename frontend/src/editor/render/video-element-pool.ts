/**
 * Pool of hidden `<video>` elements driving the new compositor.
 *
 * Replaces the per-cam `CamCanvas` mount: instead of N React-managed
 * `<video>`s stacked inside the OutputFrameBox with CSS transforms and
 * visibility toggles, the new preview pipeline mounts N `<video>`s
 * OFF the visual layout (`display:none` sibling) and the backend
 * samples whichever cam is active as a GPU texture per RAF.
 *
 * Lifecycle (per cam):
 *   - Mount `<video>` with `muted`, `playsInline`, `preload="auto"`,
 *     `crossOrigin="anonymous"` — same attrs as today's CamCanvas.
 *   - Decoder warmup: one-shot `play()` → `pause()` when the first
 *     frame is decoded (`HAVE_CURRENT_DATA`). Pushes a frame into the
 *     decoder so the user's first cam-switch already has a real
 *     picture, and the H.264/AV1/VP9 decoder is spun up before they
 *     touch a key.
 *   - On `loadedmetadata` / `resize`: report `videoWidth`/`Height` via
 *     the supplied `onDimsReport` callback (post-rotation already
 *     applied by the browser).
 *
 * Per-tick sync (drives by `syncAll(masterT, isPlaying)` from the
 * runtime's RAF):
 *   - Seek-drift correction: hard `currentTime = sourceT` when more
 *     than 100 ms off (browsers handle ~50 ms gracefully).
 *   - Play/pause based on whether the source-time is inside the cam's
 *     `[0, sourceDurationS)` range AND the master clock is playing.
 *
 * Same math as the old CamCanvas — just lifted into a class so a single
 * RAF owns N cams instead of one effect-binding per cam.
 */
import type { VideoClip } from "../types";
import { clipRangeS } from "../types";
import { camSourceTimeS } from "../../local/timing/cam-time";

export interface VideoCam {
  clip: VideoClip;
  videoUrl: string;
}

export interface VideoElementPoolOptions {
  cams: readonly VideoCam[];
  /** Reports the cam's post-rotation natural pixel dims into whatever
   *  store / mechanism owns the output-frame bbox. Called once per cam
   *  on first metadata, and again on `resize` events. */
  onDimsReport(clipId: string, width: number, height: number): void;
  /** Optional injection point for tests — defaults to
   *  `document.createElement("video")`. */
  createElement?(): HTMLVideoElement;
}

/** Per-cam slot — the `<video>` plus its derived sync constants
 *  (anchor / drift / source duration), captured once at mount time
 *  so per-tick sync is a tight closure-free function. */
interface Slot {
  clipId: string;
  el: HTMLVideoElement;
  anchorS: number;
  driftRatio: number;
  sourceDurS: number;
  warmed: boolean;
  cleanups: Array<() => void>;
}

const READY_HAVE_CURRENT_DATA = 2;

export class VideoElementPool {
  private slots = new Map<string, Slot>();
  private createElement: () => HTMLVideoElement;
  private onDimsReport: (clipId: string, w: number, h: number) => void;
  private parent: HTMLElement | null = null;

  constructor(opts: VideoElementPoolOptions) {
    this.onDimsReport = opts.onDimsReport;
    this.createElement = opts.createElement ?? (() => document.createElement("video"));
    for (const cam of opts.cams) {
      this.addSlot(cam);
    }
  }

  /** Mount all elements as children of `parent`. Idempotent — safe to
   *  call after construction once a DOM container is available. */
  mount(parent: HTMLElement): void {
    this.parent = parent;
    for (const slot of this.slots.values()) {
      if (slot.el.parentNode !== parent) {
        parent.appendChild(slot.el);
      }
    }
  }

  /** Detach all elements from the DOM but keep them in memory. Used by
   *  tests + by Compositor.tsx unmount. Doesn't clear sync state. */
  unmount(): void {
    for (const slot of this.slots.values()) {
      slot.el.remove();
    }
    this.parent = null;
  }

  /** Look up the `<video>` for a given cam. Returns null when the cam
   *  isn't in the pool (caller decides how to handle — typically renders
   *  a test-pattern fallback). */
  getElement(clipId: string): HTMLVideoElement | null {
    return this.slots.get(clipId)?.el ?? null;
  }

  /** Whether `masterT` lands inside the cam's source-time range. False
   *  for unknown ids. The runtime uses this to gate the last-good-frame
   *  fallback: out-of-range cams should stay black (correct empty
   *  state), in-range cams that are mid-seek should hold the cached
   *  frame to hide the decode-latency flash. */
  isInRange(clipId: string, masterT: number): boolean {
    const slot = this.slots.get(clipId);
    if (!slot) return false;
    const sourceT = camSourceTimeS(masterT, {
      masterStartS: slot.anchorS,
      driftRatio: slot.driftRatio,
    });
    return sourceT >= 0 && sourceT < slot.sourceDurS;
  }

  /** Re-syncs every cam in the pool against the master clock. Called
   *  by the runtime once per RAF tick. Cheap — no allocations, the
   *  hot path is one float compare per cam. */
  syncAll(masterT: number, isPlaying: boolean): void {
    for (const slot of this.slots.values()) {
      syncSlot(slot, masterT, isPlaying);
    }
  }

  /** Reconcile to a new cam list — adds slots for new cams, removes
   *  slots for vanished cams. Same-id cams keep their `<video>`
   *  (decoder stays hot). */
  setCams(cams: readonly VideoCam[]): void {
    const wantedIds = new Set(cams.map((c) => c.clip.id));
    for (const id of [...this.slots.keys()]) {
      if (!wantedIds.has(id)) {
        const slot = this.slots.get(id)!;
        for (const fn of slot.cleanups) fn();
        slot.el.remove();
        this.slots.delete(id);
      }
    }
    for (const cam of cams) {
      const existing = this.slots.get(cam.clip.id);
      if (existing) {
        // Update sync constants if the clip's drift/sync changed but
        // the id didn't — common after the user nudges a cam.
        const range = clipRangeS(cam.clip);
        existing.anchorS = range.anchorS;
        existing.driftRatio = cam.clip.driftRatio;
        existing.sourceDurS = cam.clip.sourceDurationS;
        continue;
      }
      this.addSlot(cam);
    }
  }

  dispose(): void {
    for (const slot of this.slots.values()) {
      for (const fn of slot.cleanups) fn();
      slot.el.remove();
      slot.el.removeAttribute("src");
      slot.el.load();
    }
    this.slots.clear();
    this.parent = null;
  }

  // ---- internals ----

  private addSlot(cam: VideoCam): void {
    const range = clipRangeS(cam.clip);
    const el = this.createElement();
    el.muted = true;
    el.playsInline = true;
    el.crossOrigin = "anonymous";
    el.preload = "auto";
    // Hide the element via inline styles — it's only ever sampled as a
    // texture, never displayed. `display:none` would NOT prevent decode
    // in modern browsers (the spec allows decoders for hidden videos),
    // and we explicitly want decode to keep happening so cam-switches
    // don't pay first-decode latency.
    el.style.display = "none";
    el.src = cam.videoUrl;

    const slot: Slot = {
      clipId: cam.clip.id,
      el,
      anchorS: range.anchorS,
      driftRatio: cam.clip.driftRatio,
      sourceDurS: cam.clip.sourceDurationS,
      warmed: false,
      cleanups: [],
    };

    const reportDims = () => {
      if (el.videoWidth > 0 && el.videoHeight > 0) {
        this.onDimsReport(cam.clip.id, el.videoWidth, el.videoHeight);
      }
    };
    el.addEventListener("loadedmetadata", reportDims);
    el.addEventListener("resize", reportDims);
    slot.cleanups.push(() => el.removeEventListener("loadedmetadata", reportDims));
    slot.cleanups.push(() => el.removeEventListener("resize", reportDims));
    // Try once immediately — the metadata might already be ready.
    reportDims();

    const warm = () => {
      if (slot.warmed) return;
      if (el.readyState < READY_HAVE_CURRENT_DATA) return;
      slot.warmed = true;
      const p = el.play();
      const stop = () => {
        if (!el.paused) el.pause();
      };
      if (p && typeof (p as Promise<void>).then === "function") {
        (p as Promise<void>).then(stop).catch(() => undefined);
      } else {
        stop();
      }
    };
    if (el.readyState >= READY_HAVE_CURRENT_DATA) {
      warm();
    } else {
      const onceReady = () => warm();
      el.addEventListener("loadeddata", onceReady, { once: true });
      slot.cleanups.push(() => el.removeEventListener("loadeddata", onceReady));
    }

    this.slots.set(cam.clip.id, slot);
    if (this.parent) {
      this.parent.appendChild(el);
    }
  }
}

function syncSlot(slot: Slot, masterT: number, isPlaying: boolean): void {
  const sourceT = camSourceTimeS(masterT, {
    masterStartS: slot.anchorS,
    driftRatio: slot.driftRatio,
  });
  const inRange = sourceT >= 0 && sourceT < slot.sourceDurS;
  const v = slot.el;
  if (!inRange) {
    if (!v.paused) v.pause();
    return;
  }
  if (Math.abs(v.currentTime - sourceT) > 0.1) {
    try {
      v.currentTime = Math.max(0, Math.min(slot.sourceDurS, sourceT));
    } catch {
      /* element not ready yet — next tick */
    }
  }
  if (isPlaying && v.paused) {
    v.play().catch(() => undefined);
  } else if (!isPlaying && !v.paused) {
    v.pause();
  }
}
