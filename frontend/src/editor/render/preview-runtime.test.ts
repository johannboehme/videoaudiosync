import { describe, expect, it, vi } from "vitest";
import { PreviewRuntime } from "./preview-runtime";
import type { CompositorBackend, SourcesMap } from "./backend";
import type { FrameDescriptor } from "./frame-descriptor";
import {
  VideoElementPool,
  type VideoCam,
  type VideoElementPoolOptions,
} from "./video-element-pool";
import type { Clip, ImageClip, VideoClip } from "../types";
import type { EditorStoreSnapshot } from "./build-descriptor";

function videoClip(id: string, more: Partial<VideoClip> = {}): VideoClip {
  return {
    kind: "video",
    id,
    filename: `${id}.mp4`,
    color: "#fff",
    sourceDurationS: 10,
    syncOffsetMs: 0,
    syncOverrideMs: 0,
    startOffsetS: 0,
    driftRatio: 1,
    candidates: [],
    selectedCandidateIdx: 0,
    displayW: 1920,
    displayH: 1080,
    ...more,
  };
}

function imageClip(id: string, more: Partial<ImageClip> = {}): ImageClip {
  return {
    kind: "image",
    id,
    filename: `${id}.png`,
    color: "#fff",
    durationS: 5,
    startOffsetS: 0,
    displayW: 800,
    displayH: 600,
    ...more,
  };
}

function snapshot(over: Partial<EditorStoreSnapshot> = {}): EditorStoreSnapshot {
  return {
    clips: [],
    cuts: [],
    fx: [],
    exportSpec: { preset: "web" },
    ...over,
  };
}

interface MockBackend extends CompositorBackend {
  drawFrame: ReturnType<typeof vi.fn>;
  resize: ReturnType<typeof vi.fn>;
  warmup: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
  /** Last descriptor the backend was asked to draw. */
  lastDescriptor: FrameDescriptor | null;
  /** Last sources map. */
  lastSources: SourcesMap | null;
}

function makeBackend(): MockBackend {
  const b: MockBackend = {
    id: "canvas2d",
    init: vi.fn(async () => undefined),
    resize: vi.fn(),
    warmup: vi.fn(async () => undefined),
    drawFrame: vi.fn((d: FrameDescriptor, s: SourcesMap) => {
      b.lastDescriptor = d;
      b.lastSources = s;
    }),
    dispose: vi.fn(),
    lastDescriptor: null,
    lastSources: null,
  };
  return b;
}

function makePool(): VideoElementPool {
  // Minimal stub — the pool tests cover the real logic; here we only
  // care that the runtime delegates correctly.
  const elements = new Map<string, HTMLVideoElement>();
  const pool = {
    syncAll: vi.fn(),
    getElement: vi.fn((id: string) => elements.get(id) ?? null),
    setCams: vi.fn(),
    mount: vi.fn(),
    unmount: vi.fn(),
    dispose: vi.fn(),
  } as unknown as VideoElementPool;
  // Attach a fake element for any id we want to "have" in the pool.
  (pool as unknown as { _add: (id: string) => void })._add = (id: string) => {
    elements.set(id, document.createElement("video"));
  };
  return pool;
}

function makeRuntime(opts: {
  snap: EditorStoreSnapshot;
  playback?: { currentTime: number; isPlaying: boolean };
  cams?: Record<string, { videoUrl: string }>;
  backend?: MockBackend;
  pool?: VideoElementPool;
  loadBitmap?: (url: string) => Promise<ImageBitmap>;
}) {
  const backend = opts.backend ?? makeBackend();
  const pool = opts.pool ?? makePool();
  const canvas = document.createElement("canvas");
  const cams = opts.cams ?? {};
  const playback = opts.playback ?? { currentTime: 0, isPlaying: false };
  const rt = new PreviewRuntime({
    canvas,
    cams,
    capabilities: { webgl2: false, webgpu: false },
    cssW: 100,
    cssH: 50,
    dpr: 1,
    initialScale: 1,
    createBackendFn: vi.fn(async () => backend),
    createPool: () => pool,
    raf: vi.fn(() => 0),
    cancelRaf: vi.fn(),
    readSnapshot: () => opts.snap,
    readPlayback: () => playback,
    loadBitmap: opts.loadBitmap,
  });
  return { rt, backend, pool, canvas };
}

// ----------------------------------------------------------------------

describe("PreviewRuntime — init lifecycle", () => {
  it("init creates pool + backend and warms up", async () => {
    const backend = makeBackend();
    const { rt } = makeRuntime({ snap: snapshot(), backend });
    await rt.init();
    expect(backend.warmup).toHaveBeenCalled();
  });

  it("init forwards initial caps (cssW × dpr × scale) to the backend factory", async () => {
    const backend = makeBackend();
    const factoryFn = vi.fn(async () => backend);
    const canvas = document.createElement("canvas");
    const rt = new PreviewRuntime({
      canvas,
      cams: {},
      capabilities: { webgl2: false, webgpu: false },
      cssW: 200,
      cssH: 100,
      dpr: 2,
      initialScale: 0.5,
      createBackendFn: factoryFn,
      createPool: () => makePool(),
      raf: () => 0,
      cancelRaf: () => undefined,
      readSnapshot: () => snapshot(),
      readPlayback: () => ({ currentTime: 0, isPlaying: false }),
    });
    await rt.init();
    // pixel = cssW * dpr * scale = 200 * 2 * 0.5 = 200; cssH * 2 * 0.5 = 100
    expect(factoryFn).toHaveBeenCalledWith(
      canvas,
      expect.objectContaining({ pixelW: 200, pixelH: 100, cssW: 200, cssH: 100 }),
      expect.any(Object),
    );
  });
});

describe("PreviewRuntime — tick", () => {
  it("syncs the pool, builds descriptor, calls backend.drawFrame", async () => {
    const backend = makeBackend();
    const pool = makePool();
    (pool as unknown as { _add: (id: string) => void })._add("a");
    const clips: Clip[] = [videoClip("a")];
    const { rt } = makeRuntime({
      snap: snapshot({ clips }),
      playback: { currentTime: 1.5, isPlaying: true },
      cams: { a: { videoUrl: "a.mp4" } },
      backend,
      pool,
    });
    await rt.init();
    rt.tick();
    expect((pool as unknown as { syncAll: ReturnType<typeof vi.fn> }).syncAll).toHaveBeenCalledWith(1.5, true);
    expect(backend.drawFrame).toHaveBeenCalled();
    expect(backend.lastDescriptor?.tMaster).toBe(1.5);
    expect(backend.lastDescriptor?.layers).toHaveLength(1);
  });

  it("populates the sources map with the pool's video element for the active cam", async () => {
    const backend = makeBackend();
    const pool = makePool();
    (pool as unknown as { _add: (id: string) => void })._add("a");
    const { rt } = makeRuntime({
      snap: snapshot({ clips: [videoClip("a")] }),
      playback: { currentTime: 0.5, isPlaying: false },
      cams: { a: { videoUrl: "a.mp4" } },
      backend,
      pool,
    });
    await rt.init();
    rt.tick();
    const src = backend.lastSources?.get("a");
    expect(src?.kind).toBe("video");
  });

  it("does not draw when init was not called", () => {
    const backend = makeBackend();
    const { rt } = makeRuntime({ snap: snapshot(), backend });
    rt.tick();
    expect(backend.drawFrame).not.toHaveBeenCalled();
  });
});

describe("PreviewRuntime — image bitmap cache", () => {
  it("triggers bitmap load on first tick that needs it", async () => {
    const fakeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    let loadResolve!: (bm: ImageBitmap) => void;
    const loadBitmap = vi.fn(
      () => new Promise<ImageBitmap>((res) => {
        loadResolve = res;
      }),
    );
    const backend = makeBackend();
    const { rt } = makeRuntime({
      snap: snapshot({ clips: [imageClip("img1")] }),
      cams: { img1: { videoUrl: "img1.png" } },
      backend,
      loadBitmap,
    });
    await rt.init();
    rt.tick();
    expect(loadBitmap).toHaveBeenCalledWith("img1.png");
    // First tick: bitmap not ready yet → sources map omits the entry
    expect(backend.lastSources?.get("img1")).toBeUndefined();
    // Resolve the load and tick again
    loadResolve(fakeBitmap);
    await Promise.resolve();
    rt.tick();
    expect(backend.lastSources?.get("img1")).toEqual({ kind: "image", bitmap: fakeBitmap });
  });

  it("dedupes concurrent bitmap loads for the same clip", async () => {
    const loadBitmap = vi.fn(() => new Promise<ImageBitmap>(() => {}));
    const backend = makeBackend();
    const { rt } = makeRuntime({
      snap: snapshot({ clips: [imageClip("img1")] }),
      cams: { img1: { videoUrl: "img1.png" } },
      backend,
      loadBitmap,
    });
    await rt.init();
    rt.tick();
    rt.tick();
    rt.tick();
    expect(loadBitmap).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewRuntime — resize + scale dial", () => {
  it("resize() forwards new pixel dims to the backend", async () => {
    const backend = makeBackend();
    const { rt } = makeRuntime({ snap: snapshot(), backend });
    await rt.init();
    backend.resize.mockClear();
    rt.resize(400, 200, 2);
    expect(backend.resize).toHaveBeenCalledWith(
      expect.objectContaining({ pixelW: 800, pixelH: 400, cssW: 400, cssH: 200 }),
    );
  });

  it("setScale clamps to [0.1, 2] and resizes the backbuffer", async () => {
    const backend = makeBackend();
    const { rt } = makeRuntime({ snap: snapshot(), backend });
    await rt.init();
    backend.resize.mockClear();
    rt.setScale(0.75);
    expect(backend.resize).toHaveBeenLastCalledWith(
      expect.objectContaining({ pixelW: 75, pixelH: 38 }),
    );
    rt.setScale(10); // clamps to 2
    expect(backend.resize).toHaveBeenLastCalledWith(
      expect.objectContaining({ pixelW: 200, pixelH: 100 }),
    );
    rt.setScale(0.001); // clamps to 0.1
    expect(backend.resize).toHaveBeenLastCalledWith(
      expect.objectContaining({ pixelW: 10, pixelH: 5 }),
    );
  });
});

describe("PreviewRuntime — start/stop loop", () => {
  it("start() schedules a RAF; stop() cancels it", async () => {
    const raf = vi.fn(() => 42);
    const cancelRaf = vi.fn();
    const canvas = document.createElement("canvas");
    const backend = makeBackend();
    const rt = new PreviewRuntime({
      canvas,
      cams: {},
      capabilities: { webgl2: false, webgpu: false },
      cssW: 100,
      cssH: 50,
      dpr: 1,
      createBackendFn: vi.fn(async () => backend),
      createPool: () => makePool(),
      raf,
      cancelRaf,
      readSnapshot: () => snapshot(),
      readPlayback: () => ({ currentTime: 0, isPlaying: false }),
    });
    await rt.init();
    rt.start();
    expect(raf).toHaveBeenCalledTimes(1);
    rt.stop();
    expect(cancelRaf).toHaveBeenCalledWith(42);
  });

  it("start() is idempotent — second call doesn't schedule another RAF", async () => {
    const raf = vi.fn(() => 1);
    const canvas = document.createElement("canvas");
    const backend = makeBackend();
    const rt = new PreviewRuntime({
      canvas,
      cams: {},
      capabilities: { webgl2: false, webgpu: false },
      cssW: 100,
      cssH: 50,
      dpr: 1,
      createBackendFn: vi.fn(async () => backend),
      createPool: () => makePool(),
      raf,
      cancelRaf: () => undefined,
      readSnapshot: () => snapshot(),
      readPlayback: () => ({ currentTime: 0, isPlaying: false }),
    });
    await rt.init();
    rt.start();
    rt.start();
    expect(raf).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewRuntime — dispose", () => {
  it("disposes backend, pool, and closes cached bitmaps", async () => {
    const backend = makeBackend();
    const pool = makePool();
    const fakeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const { rt } = makeRuntime({
      snap: snapshot({ clips: [imageClip("img1")] }),
      cams: { img1: { videoUrl: "img1.png" } },
      backend,
      pool,
      loadBitmap: () => Promise.resolve(fakeBitmap),
    });
    await rt.init();
    rt.tick();
    await Promise.resolve(); // let load resolve
    rt.tick(); // populate cache
    rt.dispose();
    expect(backend.dispose).toHaveBeenCalled();
    expect((pool as unknown as { dispose: ReturnType<typeof vi.fn> }).dispose).toHaveBeenCalled();
    expect(fakeBitmap.close).toHaveBeenCalled();
  });
});

// silence the "unused variable" lint for the imported VideoCam helper.
void ((): VideoCam | null => null);
void ((_: VideoElementPoolOptions) => null);
