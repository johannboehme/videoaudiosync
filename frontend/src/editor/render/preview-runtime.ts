/**
 * Live preview runtime — the single class that wires the new pipeline:
 *
 *   1. Owns the `VideoElementPool` (one `<video>` per cam, off-screen).
 *   2. Owns an `ImageBitmap` cache for image clips (loaded once each).
 *   3. Owns a `CompositorBackend` from the factory ladder.
 *   4. Drives one RAF: read store → sync pool → build descriptor →
 *      build sources map → backend.drawFrame.
 *
 * The runtime has no React. `Compositor.tsx` (Schritt 7) is a thin
 * shell that mounts the canvas + a parent for the video pool and
 * instantiates this class.
 */
import type { CompositorBackend, LayerSource, SourcesMap } from "./backend";
import { createBackend, type BackendCapabilities } from "./factory";
import {
  buildPreviewFrameDescriptor,
  type EditorStoreSnapshot,
} from "./build-descriptor";
import {
  VideoElementPool,
  type VideoCam,
  type VideoElementPoolOptions,
} from "./video-element-pool";
import { useEditorStore } from "../store";
import { isImageClip, isVideoClip, type Clip } from "../types";

export type ClipUrlMap = Readonly<Record<string, { videoUrl: string }>>;

export interface PreviewRuntimeOptions {
  canvas: HTMLCanvasElement;
  cams: ClipUrlMap;
  capabilities: BackendCapabilities;
  /** Initial CSS dims of the canvas. The runtime sets backbuffer to
   *  cssW * dpr * scale. */
  cssW: number;
  cssH: number;
  dpr?: number;
  /** Initial backbuffer scale (resolution dial). Default 1. */
  initialScale?: number;
  /** Test-injection. Defaults to the production factory. */
  createBackendFn?: typeof createBackend;
  /** Test-injection. Defaults to `new VideoElementPool(opts)`. */
  createPool?: (opts: VideoElementPoolOptions) => VideoElementPool;
  /** Test-injection — overridable RAF schedulers. Defaults to window. */
  raf?: (cb: FrameRequestCallback) => number;
  cancelRaf?: (id: number) => void;
  /** Test-injection — read EditorStoreSnapshot. Defaults to useEditorStore. */
  readSnapshot?: () => EditorStoreSnapshot;
  /** Test-injection — read playback (currentTime + isPlaying). */
  readPlayback?: () => { currentTime: number; isPlaying: boolean };
  /** Test-injection — load an image bitmap from a URL. */
  loadBitmap?: (url: string) => Promise<ImageBitmap>;
}

export class PreviewRuntime {
  private opts: Required<
    Pick<PreviewRuntimeOptions, "dpr" | "initialScale" | "raf" | "cancelRaf" | "readSnapshot" | "readPlayback" | "loadBitmap" | "createBackendFn" | "createPool">
  > &
    PreviewRuntimeOptions;

  private backend: CompositorBackend | null = null;
  private pool: VideoElementPool | null = null;
  private bitmaps = new Map<string, ImageBitmap>();
  /** Set of urls we're already loading — avoids duplicate fetches when
   *  the same image clip lingers across many RAF ticks before its
   *  bitmap resolves. */
  private bitmapsLoading = new Set<string>();

  private rafId: number | null = null;
  private running = false;
  private scale: number;
  private cssW: number;
  private cssH: number;
  private dpr: number;

  constructor(options: PreviewRuntimeOptions) {
    this.cssW = options.cssW;
    this.cssH = options.cssH;
    this.dpr = options.dpr ?? (typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1);
    this.scale = options.initialScale ?? 1;
    this.opts = {
      ...options,
      dpr: this.dpr,
      initialScale: this.scale,
      raf: options.raf ?? ((cb) => requestAnimationFrame(cb)),
      cancelRaf: options.cancelRaf ?? ((id) => cancelAnimationFrame(id)),
      readSnapshot: options.readSnapshot ?? defaultReadSnapshot,
      readPlayback: options.readPlayback ?? defaultReadPlayback,
      loadBitmap: options.loadBitmap ?? defaultLoadBitmap,
      createBackendFn: options.createBackendFn ?? createBackend,
      createPool: options.createPool ?? ((o) => new VideoElementPool(o)),
    };
  }

  /** Initialise backend + pool. Resolves once the runtime is ready to
   *  draw. After this returns the caller should call `attachVideoPool`
   *  to mount the `<video>` elements under a DOM parent, then `start()`
   *  to begin the RAF. */
  async init(): Promise<void> {
    const snapshot = this.opts.readSnapshot();
    const videoCams = collectVideoCams(snapshot.clips, this.opts.cams);
    this.pool = this.opts.createPool({
      cams: videoCams,
      onDimsReport: (id, w, h) => {
        useEditorStore.getState().setClipDisplayDims(id, w, h);
      },
    });
    const caps = this.computeCaps();
    this.backend = await this.opts.createBackendFn(this.opts.canvas, caps, this.opts.capabilities);
    await this.backend.warmup();
  }

  /** Mount the video pool's `<video>`s as children of `parent`. Safe
   *  to call multiple times — the pool itself is idempotent. */
  attachVideoPool(parent: HTMLElement): void {
    this.pool?.mount(parent);
  }

  /** Begin the RAF loop. No-op if already running. */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  /** Pause the RAF loop. Backend + pool stay alive (decoders keep
   *  running so re-start is instant). */
  stop(): void {
    this.running = false;
    if (this.rafId != null) {
      this.opts.cancelRaf(this.rafId);
      this.rafId = null;
    }
  }

  /** Resize the canvas (CSS + backbuffer). The backbuffer is sized to
   *  cssW * dpr * scale to honour the resolution dial. */
  resize(cssW: number, cssH: number, dpr?: number): void {
    this.cssW = cssW;
    this.cssH = cssH;
    if (dpr != null) this.dpr = dpr;
    if (this.backend) {
      this.backend.resize(this.computeCaps());
    }
  }

  /** Resolution dial. 1.0 = native, 0.75 = 75 % linear scale (≈56 % of
   *  pixels). The CSS size of the canvas doesn't change — the browser
   *  upscales the backbuffer at composite time, which is essentially
   *  free on the GPU. */
  setScale(scale: number): void {
    this.scale = Math.max(0.1, Math.min(2, scale));
    if (this.backend) {
      this.backend.resize(this.computeCaps());
    }
  }

  /** Hand-roll a single RAF tick. Useful for tests; production RAF
   *  loop calls this internally. */
  tick(): void {
    if (!this.backend || !this.pool) return;
    const playback = this.opts.readPlayback();
    this.pool.syncAll(playback.currentTime, playback.isPlaying);

    const snapshot = this.opts.readSnapshot();
    const descriptor = buildPreviewFrameDescriptor(snapshot, playback.currentTime);
    const sources = this.buildSourcesMap(descriptor.layers, snapshot.clips);

    // Reconcile pool to current cam list — handles user added/removed cams.
    this.pool.setCams(collectVideoCams(snapshot.clips, this.opts.cams));

    this.backend.drawFrame(descriptor, sources);
  }

  /** Stop the RAF, dispose backend + pool, revoke cached bitmaps. */
  dispose(): void {
    this.stop();
    if (this.pool) {
      this.pool.dispose();
      this.pool = null;
    }
    if (this.backend) {
      this.backend.dispose();
      this.backend = null;
    }
    for (const bm of this.bitmaps.values()) {
      try {
        bm.close();
      } catch {
        /* already closed */
      }
    }
    this.bitmaps.clear();
    this.bitmapsLoading.clear();
  }

  // ---- internals ----

  private scheduleNext(): void {
    this.rafId = this.opts.raf(() => {
      this.rafId = null;
      if (!this.running) return;
      this.tick();
      this.scheduleNext();
    });
  }

  private computeCaps(): { pixelW: number; pixelH: number; cssW: number; cssH: number } {
    const pixelW = Math.max(1, Math.round(this.cssW * this.dpr * this.scale));
    const pixelH = Math.max(1, Math.round(this.cssH * this.dpr * this.scale));
    return { pixelW, pixelH, cssW: this.cssW, cssH: this.cssH };
  }

  private buildSourcesMap(
    layers: ReadonlyArray<{ layerId: string; source: { kind: string } }>,
    clips: readonly Clip[],
  ): SourcesMap {
    const out = new Map<string, LayerSource>();
    for (const layer of layers) {
      if (layer.source.kind === "video") {
        const el = this.pool?.getElement(layer.layerId);
        if (el) out.set(layer.layerId, { kind: "video", element: el });
      } else if (layer.source.kind === "image") {
        const cached = this.bitmaps.get(layer.layerId);
        if (cached) {
          out.set(layer.layerId, { kind: "image", bitmap: cached });
        } else {
          this.ensureImageBitmap(layer.layerId, clips);
        }
      }
    }
    return out;
  }

  private ensureImageBitmap(clipId: string, clips: readonly Clip[]): void {
    if (this.bitmaps.has(clipId)) return;
    if (this.bitmapsLoading.has(clipId)) return;
    const clip = clips.find((c) => c.id === clipId);
    if (!clip || !isImageClip(clip)) return;
    const url = this.opts.cams[clipId]?.videoUrl;
    if (!url) return;
    this.bitmapsLoading.add(clipId);
    void this.opts
      .loadBitmap(url)
      .then((bm) => {
        this.bitmapsLoading.delete(clipId);
        if (this.bitmaps.has(clipId)) {
          // Race: another load won. Drop the loser.
          bm.close();
          return;
        }
        this.bitmaps.set(clipId, bm);
      })
      .catch((err) => {
        this.bitmapsLoading.delete(clipId);
        console.warn(`[compositor] image bitmap load failed for ${clipId}:`, err);
      });
  }
}

// ---- defaults ----

function defaultReadSnapshot(): EditorStoreSnapshot {
  const s = useEditorStore.getState();
  return { clips: s.clips, cuts: s.cuts, fx: s.fx, exportSpec: s.exportSpec };
}

function defaultReadPlayback(): { currentTime: number; isPlaying: boolean } {
  const s = useEditorStore.getState();
  return { currentTime: s.playback.currentTime, isPlaying: s.playback.isPlaying };
}

async function defaultLoadBitmap(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  const blob = await res.blob();
  return createImageBitmap(blob);
}

function collectVideoCams(clips: readonly Clip[], cams: ClipUrlMap): VideoCam[] {
  const out: VideoCam[] = [];
  for (const clip of clips) {
    if (!isVideoClip(clip)) continue;
    const url = cams[clip.id]?.videoUrl;
    if (!url) continue;
    out.push({ clip, videoUrl: url });
  }
  return out;
}
