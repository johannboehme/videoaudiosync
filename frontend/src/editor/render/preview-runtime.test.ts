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

describe("PreviewRuntime — setCams (live + Media flow)", () => {
  it("forwards a newly-added cam URL to the pool on the next tick", async () => {
    // Repro for the bug where adding a video to an already-running editor
    // wouldn't actually mount its <video> element: the pool's setCams was
    // called with the STALE cams map captured at construction time.
    const backend = makeBackend();
    const pool = makePool();
    const setCamsSpy = (pool as unknown as { setCams: ReturnType<typeof vi.fn> })
      .setCams;
    (pool as unknown as { _add: (id: string) => void })._add("a");
    const clipsBefore: Clip[] = [videoClip("a")];
    const playback = { currentTime: 0, isPlaying: false };
    const snap: { value: EditorStoreSnapshot } = { value: snapshot({ clips: clipsBefore }) };
    const canvas = document.createElement("canvas");
    const rt = new PreviewRuntime({
      canvas,
      cams: { a: { videoUrl: "a.mp4" } },
      capabilities: { webgl2: false, webgpu: false },
      cssW: 100,
      cssH: 50,
      dpr: 1,
      initialScale: 1,
      createBackendFn: vi.fn(async () => backend),
      createPool: () => pool,
      raf: () => 0,
      cancelRaf: () => undefined,
      readSnapshot: () => snap.value,
      readPlayback: () => playback,
    });
    await rt.init();

    // Simulate the editor's "+ Media" flow: a 2nd cam gets appended to
    // the store AND its URL is registered in the runtime's cams map.
    snap.value = snapshot({ clips: [videoClip("a"), videoClip("b")] });
    rt.setCams({ a: { videoUrl: "a.mp4" }, b: { videoUrl: "b.mp4" } });
    setCamsSpy.mockClear();
    rt.tick();

    // Pool should be reconciled with BOTH cams now.
    expect(setCamsSpy).toHaveBeenCalledTimes(1);
    const arg = setCamsSpy.mock.calls[0][0] as VideoCam[];
    const ids = arg.map((c) => c.clip.id).sort();
    expect(ids).toEqual(["a", "b"]);
    const newCam = arg.find((c) => c.clip.id === "b");
    expect(newCam?.videoUrl).toBe("b.mp4");
  });

  it("uses the updated cams map when loading bitmaps for newly-added image clips", async () => {
    const fakeBitmap = { close: vi.fn() } as unknown as ImageBitmap;
    const loadBitmap = vi.fn(async () => fakeBitmap);
    const backend = makeBackend();
    const pool = makePool();
    const playback = { currentTime: 0, isPlaying: false };
    const snap: { value: EditorStoreSnapshot } = { value: snapshot({ clips: [] }) };
    const canvas = document.createElement("canvas");
    const rt = new PreviewRuntime({
      canvas,
      cams: {},
      capabilities: { webgl2: false, webgpu: false },
      cssW: 100,
      cssH: 50,
      dpr: 1,
      initialScale: 1,
      createBackendFn: vi.fn(async () => backend),
      createPool: () => pool,
      raf: () => 0,
      cancelRaf: () => undefined,
      readSnapshot: () => snap.value,
      readPlayback: () => playback,
      loadBitmap,
    });
    await rt.init();

    snap.value = snapshot({ clips: [imageClip("img1")] });
    rt.setCams({ img1: { videoUrl: "img1.png" } });
    rt.tick();

    expect(loadBitmap).toHaveBeenCalledWith("img1.png");
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

describe("PreviewRuntime — pool reconciliation dirty-flag", () => {
  // pool.setCams reconciles slots (Set membership + per-slot updates).
  // It allocates a new VideoCam[] every call. On a quiet timeline that
  // never changes, calling it 60×/sec is pure GC churn. The runtime
  // should only re-reconcile when the clips list reference OR the cams
  // URL map reference actually changes.

  it("does NOT call pool.setCams when neither clips nor cams map changed", async () => {
    const backend = makeBackend();
    const pool = makePool();
    const setCamsSpy = (pool as unknown as { setCams: ReturnType<typeof vi.fn> })
      .setCams;
    const clips: Clip[] = [videoClip("a")];
    const snap: { value: EditorStoreSnapshot } = { value: snapshot({ clips }) };
    const { rt } = makeRuntime({
      snap: snap.value,
      cams: { a: { videoUrl: "a.mp4" } },
      backend,
      pool,
    });
    // Force the test runtime to read the same snapshot ref each tick
    // (the makeRuntime helper captures opts.snap at construction).
    rt["opts"].readSnapshot = () => snap.value;
    await rt.init();
    setCamsSpy.mockClear();
    rt.tick();
    rt.tick();
    rt.tick();
    expect(setCamsSpy).not.toHaveBeenCalled();
  });

  it("calls pool.setCams once when the clips list reference changes", async () => {
    const backend = makeBackend();
    const pool = makePool();
    const setCamsSpy = (pool as unknown as { setCams: ReturnType<typeof vi.fn> })
      .setCams;
    const snap: { value: EditorStoreSnapshot } = {
      value: snapshot({ clips: [videoClip("a")] }),
    };
    const { rt } = makeRuntime({
      snap: snap.value,
      cams: { a: { videoUrl: "a.mp4" } },
      backend,
      pool,
    });
    rt["opts"].readSnapshot = () => snap.value;
    await rt.init();
    setCamsSpy.mockClear();
    rt.tick();
    // New clips array reference (e.g. user added a clip).
    snap.value = snapshot({ clips: [videoClip("a"), videoClip("b")] });
    rt.tick();
    rt.tick(); // unchanged after the propagation tick
    expect(setCamsSpy).toHaveBeenCalledTimes(1);
  });

  it("calls pool.setCams once when the cams URL map reference changes", async () => {
    const backend = makeBackend();
    const pool = makePool();
    const setCamsSpy = (pool as unknown as { setCams: ReturnType<typeof vi.fn> })
      .setCams;
    const snap: { value: EditorStoreSnapshot } = {
      value: snapshot({ clips: [videoClip("a")] }),
    };
    const { rt } = makeRuntime({
      snap: snap.value,
      cams: { a: { videoUrl: "a.mp4" } },
      backend,
      pool,
    });
    rt["opts"].readSnapshot = () => snap.value;
    await rt.init();
    setCamsSpy.mockClear();
    rt.tick();
    rt.setCams({ a: { videoUrl: "a.mp4" }, b: { videoUrl: "b.mp4" } });
    rt.tick();
    rt.tick();
    expect(setCamsSpy).toHaveBeenCalledTimes(1);
  });
});

describe("PreviewRuntime — frame-budget watchdog", () => {
  /** Helper: build a runtime with an injected clock so we can simulate
   *  ticks of arbitrary duration. */
  function makeWithClock(opts: {
    backend?: MockBackend;
    pool?: VideoElementPool;
    frameBudgetMs?: number;
    /** Sequence of (tick-start, intermediate, tick-end) timestamps the
     *  injected `now()` returns in order. */
    nowSequence?: number[];
  }) {
    const backend = opts.backend ?? makeBackend();
    const pool = opts.pool ?? makePool();
    let nowIdx = 0;
    const nowSeq = opts.nowSequence ?? [];
    const canvas = document.createElement("canvas");
    const rt = new PreviewRuntime({
      canvas,
      cams: {},
      capabilities: { webgl2: false, webgpu: false },
      cssW: 100,
      cssH: 50,
      dpr: 1,
      initialScale: 1,
      frameBudgetMs: opts.frameBudgetMs ?? 14,
      createBackendFn: vi.fn(async () => backend),
      createPool: () => pool,
      raf: () => 0,
      cancelRaf: () => undefined,
      readSnapshot: () => snapshot(),
      readPlayback: () => ({ currentTime: 0, isPlaying: false }),
      now: () => {
        const v = nowSeq[Math.min(nowIdx, nowSeq.length - 1)] ?? 0;
        nowIdx++;
        return v;
      },
    });
    return { rt, backend, pool, advanceTick: () => rt.tick() };
  }

  it("draws normally when ticks stay under the budget", async () => {
    // Each tick reads now() at: tickStart, drawStart, drawEnd, tickEnd.
    // 4 reads/tick → 8 entries for 2 ticks. Both ticks: 5 ms total.
    const seq = [0, 1, 4, 5, 100, 101, 104, 105];
    const { rt, backend } = makeWithClock({ nowSequence: seq, frameBudgetMs: 14 });
    await rt.init();
    rt.tick();
    rt.tick();
    expect(backend.drawFrame).toHaveBeenCalledTimes(2);
  });

  it("skips the next draw after a tick that exceeded the budget", async () => {
    // Tick 1: 30ms total → blows 14ms budget → arms the skip
    // Tick 2: must skip drawFrame
    // Tick 3: short again → resumes drawing
    // 4 now()-reads per non-skipped tick (start, drawStart, drawEnd, tickEnd)
    // 2 now()-reads per skipped tick (start, tickEnd).
    const seq = [
      0, 1, 30, 31, // tick 1: 31ms
      100, 102, // tick 2: skipped — no drawFrame timestamps
      200, 201, 204, 205, // tick 3: 5ms
    ];
    const { rt, backend } = makeWithClock({ nowSequence: seq, frameBudgetMs: 14 });
    await rt.init();
    rt.tick(); // overshoots — schedules skip
    expect(backend.drawFrame).toHaveBeenCalledTimes(1);
    rt.tick(); // skip
    expect(backend.drawFrame).toHaveBeenCalledTimes(1);
    rt.tick(); // back to drawing
    expect(backend.drawFrame).toHaveBeenCalledTimes(2);
  });

  it("still syncs the video pool on a skipped tick (cam decoders stay aligned)", async () => {
    const seq = [
      0, 1, 30, 31, // tick 1
      100, 102, // tick 2 (skipped)
    ];
    const pool = makePool();
    const { rt } = makeWithClock({ nowSequence: seq, pool, frameBudgetMs: 14 });
    await rt.init();
    rt.tick(); // overshoots
    rt.tick(); // skipped
    const syncSpy = (pool as unknown as { syncAll: ReturnType<typeof vi.fn> }).syncAll;
    // pool.syncAll fired on both ticks (init does not call it).
    expect(syncSpy).toHaveBeenCalledTimes(2);
  });

  it("disabling the watchdog (frameBudgetMs=Infinity) never skips", async () => {
    const seq = [
      0, 1, 100, 101, // 101ms — would normally trigger skip
      200, 201, 300, 301,
    ];
    const { rt, backend } = makeWithClock({
      nowSequence: seq,
      frameBudgetMs: Infinity,
    });
    await rt.init();
    rt.tick();
    rt.tick();
    expect(backend.drawFrame).toHaveBeenCalledTimes(2);
  });
});

// silence the "unused variable" lint for the imported VideoCam helper.
void ((): VideoCam | null => null);
void ((_: VideoElementPoolOptions) => null);
