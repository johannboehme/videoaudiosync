import { describe, expect, it, vi } from "vitest";
import { VideoElementPool, type VideoCam } from "./video-element-pool";
import type { VideoClip } from "../types";

/** A controllable fake `<video>` — exposes the surface VideoElementPool
 *  reads/writes (readyState, currentTime, paused, videoWidth/Height,
 *  play/pause/load) plus event listener bookkeeping so we can simulate
 *  loadedmetadata / loadeddata / resize. */
function makeFakeVideo() {
  const listeners = new Map<string, Set<EventListener>>();
  const dispatch = (type: string) => {
    const set = listeners.get(type);
    if (!set) return;
    for (const fn of set) fn(new Event(type));
  };
  const element = {
    src: "",
    muted: false,
    playsInline: false,
    crossOrigin: "" as string | null,
    preload: "",
    readyState: 0,
    currentTime: 0,
    paused: true,
    videoWidth: 0,
    videoHeight: 0,
    style: {} as Record<string, string>,
    parentNode: null,
    play: vi.fn(async () => {
      element.paused = false;
    }),
    pause: vi.fn(() => {
      element.paused = true;
    }),
    load: vi.fn(),
    remove: vi.fn(() => {
      element.parentNode = null;
    }),
    removeAttribute: vi.fn(),
    addEventListener(type: string, fn: EventListener) {
      let set = listeners.get(type);
      if (!set) {
        set = new Set();
        listeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener(type: string, fn: EventListener) {
      listeners.get(type)?.delete(fn);
    },
    /** test-only — fire an event */
    _fire: dispatch,
  };
  return element;
}

type FakeVideo = ReturnType<typeof makeFakeVideo>;

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
    ...more,
  };
}

function cam(id: string, more: Partial<VideoClip> = {}): VideoCam {
  return { clip: videoClip(id, more), videoUrl: `${id}.mp4` };
}

function makePoolWithFakes(cams: VideoCam[]) {
  const fakes: FakeVideo[] = [];
  const onDims = vi.fn();
  const pool = new VideoElementPool({
    cams,
    onDimsReport: onDims,
    createElement: () => {
      const f = makeFakeVideo();
      fakes.push(f);
      return f as unknown as HTMLVideoElement;
    },
  });
  return { pool, fakes, onDims };
}

// ----------------------------------------------------------------------

describe("VideoElementPool — construction + element setup", () => {
  it("creates one element per cam with correct attrs", () => {
    const { fakes } = makePoolWithFakes([cam("a"), cam("b")]);
    expect(fakes).toHaveLength(2);
    for (const f of fakes) {
      expect(f.muted).toBe(true);
      expect(f.playsInline).toBe(true);
      expect(f.crossOrigin).toBe("anonymous");
      expect(f.preload).toBe("auto");
      expect(f.style.display).toBe("none");
    }
    expect(fakes[0].src).toBe("a.mp4");
    expect(fakes[1].src).toBe("b.mp4");
  });

  it("getElement returns the element for a known clipId, null otherwise", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    expect(pool.getElement("a")).toBe(fakes[0]);
    expect(pool.getElement("nonexistent")).toBeNull();
  });
});

describe("VideoElementPool — DOM mount", () => {
  it("mount() appends every element under the parent", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a"), cam("b")]);
    const parent = { appendChild: vi.fn() } as unknown as HTMLElement;
    pool.mount(parent);
    expect((parent as unknown as { appendChild: ReturnType<typeof vi.fn> }).appendChild)
      .toHaveBeenCalledTimes(2);
    expect((parent as unknown as { appendChild: ReturnType<typeof vi.fn> }).appendChild)
      .toHaveBeenNthCalledWith(1, fakes[0]);
  });

  it("unmount() removes elements and clears parent ref", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    const parent = { appendChild: vi.fn() } as unknown as HTMLElement;
    pool.mount(parent);
    pool.unmount();
    expect(fakes[0].remove).toHaveBeenCalledTimes(1);
  });
});

describe("VideoElementPool — dims reporting", () => {
  it("reports dims on loadedmetadata when videoWidth/Height > 0", () => {
    const { fakes, onDims } = makePoolWithFakes([cam("a")]);
    fakes[0].videoWidth = 1920;
    fakes[0].videoHeight = 1080;
    fakes[0]._fire("loadedmetadata");
    expect(onDims).toHaveBeenLastCalledWith("a", 1920, 1080);
  });

  it("does NOT report when videoWidth is 0", () => {
    const { fakes, onDims } = makePoolWithFakes([cam("a")]);
    onDims.mockClear();
    fakes[0]._fire("loadedmetadata");
    expect(onDims).not.toHaveBeenCalled();
  });

  it("re-reports on resize (rotation events)", () => {
    const { fakes, onDims } = makePoolWithFakes([cam("a")]);
    fakes[0].videoWidth = 1080;
    fakes[0].videoHeight = 1920;
    fakes[0]._fire("resize");
    expect(onDims).toHaveBeenLastCalledWith("a", 1080, 1920);
  });
});

describe("VideoElementPool — decoder warmup", () => {
  it("does not warm when readyState < HAVE_CURRENT_DATA", () => {
    const { fakes } = makePoolWithFakes([cam("a")]);
    expect(fakes[0].play).not.toHaveBeenCalled();
  });

  it("warms (play→pause) once readyState reaches HAVE_CURRENT_DATA via loadeddata", async () => {
    const { fakes } = makePoolWithFakes([cam("a")]);
    fakes[0].readyState = 2;
    fakes[0]._fire("loadeddata");
    // wait one microtask for the play().then(pause)
    await Promise.resolve();
    expect(fakes[0].play).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    expect(fakes[0].pause).toHaveBeenCalledTimes(1);
  });

  it("warms only once even if loadeddata fires multiple times", async () => {
    const { fakes } = makePoolWithFakes([cam("a")]);
    fakes[0].readyState = 2;
    fakes[0]._fire("loadeddata");
    await Promise.resolve();
    fakes[0]._fire("loadeddata");
    await Promise.resolve();
    expect(fakes[0].play).toHaveBeenCalledTimes(1);
  });
});

describe("VideoElementPool — syncAll behaviour", () => {
  it("seeks element when drift > 100 ms", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    fakes[0].currentTime = 0;
    pool.syncAll(0.5, false); // sourceT=0.5, drift=0.5 → seek
    expect(fakes[0].currentTime).toBe(0.5);
  });

  it("does NOT seek when drift ≤ 100 ms", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    fakes[0].currentTime = 0.45;
    pool.syncAll(0.5, false); // drift = 0.05 < 0.1
    expect(fakes[0].currentTime).toBe(0.45);
  });

  it("plays element when in-range and isPlaying=true", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    fakes[0].paused = true;
    pool.syncAll(2, true);
    expect(fakes[0].play).toHaveBeenCalled();
  });

  it("pauses element when isPlaying=false even if in-range", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    fakes[0].paused = false;
    pool.syncAll(2, false);
    expect(fakes[0].pause).toHaveBeenCalled();
  });

  it("pauses element when sourceT is outside [0, sourceDurS)", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a", { sourceDurationS: 5 })]);
    fakes[0].paused = false;
    pool.syncAll(10, true); // sourceT=10, sourceDurS=5 → out of range
    expect(fakes[0].pause).toHaveBeenCalled();
  });

  it("respects syncOffsetMs / driftRatio in sourceTime calculation", () => {
    // syncOffsetMs=200 → anchor = -0.2; drift=2 → sourceT(t=0.5) = (0.5+0.2)*2 = 1.4
    const { pool, fakes } = makePoolWithFakes([
      cam("a", { syncOffsetMs: 200, driftRatio: 2, sourceDurationS: 10 }),
    ]);
    pool.syncAll(0.5, false);
    expect(fakes[0].currentTime).toBeCloseTo(1.4, 6);
  });
});

describe("VideoElementPool — setCams reconciliation", () => {
  it("removes vanished slots", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a"), cam("b")]);
    pool.setCams([cam("a")]);
    expect(pool.getElement("b")).toBeNull();
    expect(fakes[1].remove).toHaveBeenCalled();
  });

  it("adds new slots without recreating existing ones", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a")]);
    pool.setCams([cam("a"), cam("b")]);
    expect(pool.getElement("a")).toBe(fakes[0]);
    expect(pool.getElement("b")).not.toBeNull();
    expect(pool.getElement("b")).not.toBe(fakes[0]);
  });

  it("updates sync constants when same-id clip changes drift", () => {
    const { pool, fakes } = makePoolWithFakes([
      cam("a", { driftRatio: 1, sourceDurationS: 10 }),
    ]);
    pool.setCams([cam("a", { driftRatio: 2, sourceDurationS: 10 })]);
    pool.syncAll(0.5, false);
    expect(fakes[0].currentTime).toBeCloseTo(1.0, 6); // (0.5)*2
  });
});

describe("VideoElementPool — dispose", () => {
  it("cleans up all slots and clears the map", () => {
    const { pool, fakes } = makePoolWithFakes([cam("a"), cam("b")]);
    pool.dispose();
    expect(pool.getElement("a")).toBeNull();
    expect(pool.getElement("b")).toBeNull();
    expect(fakes[0].remove).toHaveBeenCalled();
    expect(fakes[1].remove).toHaveBeenCalled();
  });
});
