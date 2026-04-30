/**
 * Tests for the audio-master hook — `<audio>`-element drives the master
 * clock. The hook owns no DOM itself; the caller renders an `<audio>` tag
 * with a ref and passes that ref + the audio URL to the hook. The hook
 * subscribes to the editor store and:
 *   - mirrors `audioElement.currentTime` into `playback.currentTime` while playing,
 *   - calls play()/pause() in response to `playback.isPlaying`,
 *   - applies seekRequest by writing `audioElement.currentTime`,
 *   - reports duration once `loadedmetadata` fires.
 *
 * Importantly the hook does NOT touch any cam <video> element. The cams
 * are slaves of the store's currentTime — see VideoElementPool tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { useAudioMaster } from "./useAudioMaster";
import { useEditorStore } from "./store";

function flushAll(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

function mockMediaElement(audio: HTMLAudioElement): {
  setDuration: (d: number) => void;
  fireLoadedMetadata: () => void;
  fireEnded: () => void;
  setCurrentTime: (t: number) => void;
  getCurrentTime: () => number;
  isPaused: () => boolean;
  playSpy: ReturnType<typeof vi.fn>;
  pauseSpy: ReturnType<typeof vi.fn>;
} {
  let curT = 0;
  let paused = true;
  let dur = NaN;
  Object.defineProperty(audio, "currentTime", {
    configurable: true,
    get: () => curT,
    set: (v: number) => {
      curT = v;
    },
  });
  Object.defineProperty(audio, "duration", {
    configurable: true,
    get: () => dur,
  });
  Object.defineProperty(audio, "paused", {
    configurable: true,
    get: () => paused,
  });
  const playSpy = vi.fn(() => {
    paused = false;
    return Promise.resolve();
  });
  const pauseSpy = vi.fn(() => {
    paused = true;
  });
  Object.defineProperty(audio, "play", {
    configurable: true,
    value: playSpy,
  });
  Object.defineProperty(audio, "pause", {
    configurable: true,
    value: pauseSpy,
  });
  return {
    setDuration: (d) => {
      dur = d;
    },
    fireLoadedMetadata: () => audio.dispatchEvent(new Event("loadedmetadata")),
    fireEnded: () => audio.dispatchEvent(new Event("ended")),
    setCurrentTime: (t) => {
      curT = t;
    },
    getCurrentTime: () => curT,
    isPaused: () => paused,
    playSpy,
    pauseSpy,
  };
}

interface Refs {
  audio: HTMLAudioElement;
  ready: boolean;
  duration: number | null;
}

function Harness({
  audioUrl,
  refs,
}: {
  audioUrl: string;
  refs: Refs;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const handle = useAudioMaster(audioRef, audioUrl);
  useEffect(() => {
    if (audioRef.current) refs.audio = audioRef.current;
    refs.ready = handle.isReady;
    refs.duration = handle.audioDuration;
  });
  // Render the audio element so the hook has something to drive.
  return (
    <audio
      ref={audioRef}
      src={audioUrl}
      preload="auto"
      data-testid="master-audio"
    />
  );
}

afterEach(() => {
  useEditorStore.getState().reset();
});

describe("useAudioMaster — master-clock from <audio> element", () => {
  let refs: Refs;
  beforeEach(() => {
    refs = {
      audio: undefined as unknown as HTMLAudioElement,
      ready: false,
      duration: null,
    };
  });

  it("reports loadedmetadata duration into the handle and store", async () => {
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 5,
      width: 100,
      height: 100,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
    render(<Harness audioUrl="/x.wav" refs={refs} />);
    await flushAll();
    const m = mockMediaElement(refs.audio);
    m.setDuration(5.5);
    await act(async () => {
      m.fireLoadedMetadata();
      await flushAll();
    });
    expect(refs.ready).toBe(true);
    expect(refs.duration).toBeCloseTo(5.5, 6);
  });

  it("calls audioElement.play() when store.isPlaying flips to true", async () => {
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 5,
      width: 100,
      height: 100,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
    render(<Harness audioUrl="/x.wav" refs={refs} />);
    await flushAll();
    const m = mockMediaElement(refs.audio);
    m.setDuration(5);
    await act(async () => {
      m.fireLoadedMetadata();
      await flushAll();
    });
    await act(async () => {
      useEditorStore.getState().setPlaying(true);
      await flushAll();
    });
    expect(m.playSpy).toHaveBeenCalled();
    expect(m.isPaused()).toBe(false);
  });

  it("calls audioElement.pause() when store.isPlaying flips to false", async () => {
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 5,
      width: 100,
      height: 100,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
    render(<Harness audioUrl="/x.wav" refs={refs} />);
    await flushAll();
    const m = mockMediaElement(refs.audio);
    m.setDuration(5);
    await act(async () => {
      m.fireLoadedMetadata();
      await flushAll();
    });
    await act(async () => {
      useEditorStore.getState().setPlaying(true);
      await flushAll();
    });
    await act(async () => {
      useEditorStore.getState().setPlaying(false);
      await flushAll();
    });
    expect(m.pauseSpy).toHaveBeenCalled();
    expect(m.isPaused()).toBe(true);
  });

  it("applies seekRequest by writing audioElement.currentTime", async () => {
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 10,
      width: 100,
      height: 100,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
    render(<Harness audioUrl="/x.wav" refs={refs} />);
    await flushAll();
    const m = mockMediaElement(refs.audio);
    m.setDuration(10);
    await act(async () => {
      m.fireLoadedMetadata();
      await flushAll();
    });
    await act(async () => {
      useEditorStore.getState().seek(3.7);
      await flushAll();
    });
    expect(m.getCurrentTime()).toBeCloseTo(3.7, 5);
    // seek should be cleared so a follow-up seek to the same value re-triggers.
    expect(useEditorStore.getState().playback.seekRequest).toBeNull();
  });

  it("mirrors audioElement.currentTime into store.playback.currentTime while playing", async () => {
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 10,
      width: 100,
      height: 100,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
    render(<Harness audioUrl="/x.wav" refs={refs} />);
    await flushAll();
    const m = mockMediaElement(refs.audio);
    m.setDuration(10);
    await act(async () => {
      m.fireLoadedMetadata();
      await flushAll();
    });
    await act(async () => {
      useEditorStore.getState().setPlaying(true);
      await flushAll();
    });
    // Simulate audio advancing 1.0 s.
    await act(async () => {
      m.setCurrentTime(1.0);
      // Allow at least one RAF tick.
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    const t = useEditorStore.getState().playback.currentTime;
    expect(t).toBeCloseTo(1.0, 1);
  });

  it("auto-pauses when the master clock reaches duration", async () => {
    useEditorStore.getState().loadJob({
      id: "j",
      fps: 30,
      duration: 4,
      width: 100,
      height: 100,
      algoOffsetMs: 0,
      driftRatio: 1,
    });
    render(<Harness audioUrl="/x.wav" refs={refs} />);
    await flushAll();
    const m = mockMediaElement(refs.audio);
    m.setDuration(4);
    await act(async () => {
      m.fireLoadedMetadata();
      await flushAll();
    });
    await act(async () => {
      useEditorStore.getState().setPlaying(true);
      await flushAll();
    });
    await act(async () => {
      m.setCurrentTime(4.0);
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
      await new Promise((r) => requestAnimationFrame(() => r(undefined)));
    });
    expect(useEditorStore.getState().playback.isPlaying).toBe(false);
  });

  it("does NOT touch any video element — hook signature accepts only audio", () => {
    // This is a *type-level* assertion: if useAudioMaster ever grows a
    // videoRef parameter again, the test (and the architecture) regress.
    // We satisfy it by reading the hook's length (number of declared
    // parameters); 2 = (audioRef, audioUrl).
    expect(useAudioMaster.length).toBe(2);
  });
});
