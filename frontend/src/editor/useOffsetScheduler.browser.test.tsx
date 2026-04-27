import { afterEach, describe, expect, it } from "vitest";
import { act, render } from "@testing-library/react";
import { useEffect, useRef } from "react";
import { useOffsetScheduler } from "./useOffsetScheduler";
import { useEditorStore } from "./store";

/**
 * Real-Chromium integration test for the offset scheduler.
 *
 * Verifies the live preview wiring: when the user nudges the offset knob
 * during playback, the audio source is rescheduled with the new offset
 * value. The bug we're guarding against: the rVFC tick captures
 * `lastTotalMs` and only re-schedules when the value changes — if the
 * subscription wiring isn't right, the user's knob input would never
 * propagate to the audio.
 */

const VIDEO_URL = "/__test_fixtures__/tone-3s.mp4";

function makeStudioWavBlob(): Blob {
  const sr = 48000;
  const n = sr * 4;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    samples[i] = 0.4 * Math.sin((2 * Math.PI * 660 * i) / sr);
  }
  const dataLen = n * 2;
  const buf = new ArrayBuffer(44 + dataLen);
  const dv = new DataView(buf);
  dv.setUint32(0, 0x52494646, false);
  dv.setUint32(4, 36 + dataLen, true);
  dv.setUint32(8, 0x57415645, false);
  dv.setUint32(12, 0x666d7420, false);
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sr, true);
  dv.setUint32(28, sr * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  dv.setUint32(36, 0x64617461, false);
  dv.setUint32(40, dataLen, true);
  let off = 44;
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    off += 2;
  }
  return new Blob([buf], { type: "audio/wav" });
}

interface ScheduleEvent {
  bufferDuration: number;
  startOffset: number;
  ctxTime: number;
}

function trackBufferSourceCreation(): {
  scheduled: ScheduleEvent[];
  restore: () => void;
} {
  const scheduled: ScheduleEvent[] = [];
  const origCreate = AudioContext.prototype.createBufferSource;
  AudioContext.prototype.createBufferSource = function () {
    const ctx = this;
    const src = origCreate.call(ctx);
    const origStart = src.start.bind(src);
    src.start = ((when?: number, offset?: number) => {
      scheduled.push({
        bufferDuration: src.buffer?.duration ?? 0,
        startOffset: offset ?? 0,
        ctxTime: ctx.currentTime,
      });
      return origStart(when ?? 0, offset);
    }) as typeof src.start;
    return src;
  };
  return {
    scheduled,
    restore: () => {
      AudioContext.prototype.createBufferSource = origCreate;
    },
  };
}

function Harness({ audioUrl }: { audioUrl: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const handle = useOffsetScheduler(videoRef, audioUrl);
  // Expose ref + readiness to the test via a global stash.
  useEffect(() => {
    (window as unknown as { __harness: { video: HTMLVideoElement | null; ready: boolean } }).__harness = {
      video: videoRef.current,
      ready: handle.isReady,
    };
  });
  return (
    <video
      ref={videoRef}
      src={VIDEO_URL}
      muted
      playsInline
      crossOrigin="anonymous"
      preload="auto"
    />
  );
}

afterEach(() => {
  useEditorStore.getState().reset();
});

describe("useOffsetScheduler — live offset propagation", () => {
  it(
    "reschedules the audio source when userOverrideMs changes during playback",
    async () => {
      // 1. Build a same-origin blob URL for the studio audio so the hook
      //    can fetch it without CORS / COEP issues.
      const audioUrl = URL.createObjectURL(makeStudioWavBlob());

      // 2. Spy on AudioContext.createBufferSource.
      const tracker = trackBufferSourceCreation();
      try {
        // 3. Set up a non-trivial algorithm offset so totalOffsetMs starts > 0.
        useEditorStore.getState().loadJob({
          id: "scrubber-test",
          fps: 30,
          duration: 3,
          width: 320,
          height: 240,
          algoOffsetMs: 200,
          driftRatio: 1,
        });

        const { unmount } = render(<Harness audioUrl={audioUrl} />);

        // Wait for studio audio decode to finish.
        await waitFor(
          () =>
            (
              window as unknown as { __harness?: { ready: boolean } }
            ).__harness?.ready === true,
          5000,
        );
        const v = (window as unknown as { __harness: { video: HTMLVideoElement } }).__harness.video;
        expect(v).toBeTruthy();

        // Wait for the video to have any duration metadata so play() works.
        if (v.readyState < 1) {
          await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
        }

        // 4. Play. AudioContext autoplay policy: requires user gesture in
        //    headless Chromium too unless the page has `--autoplay-policy=
        //    no-user-gesture-required`. We bypass by directly resuming the
        //    audio context after play.
        await v.play().catch(() => undefined);
        // Some Chromium builds throw — manually trigger schedule by changing
        // the offset, which the hook's tick should pick up regardless.

        // Wait briefly so the rVFC has a chance to fire at least once.
        await sleep(150);

        // Seek so subsequent schedules have a non-zero start offset we can
        // distinguish.
        v.currentTime = 2.0;
        await sleep(150);
        const baselineCount = tracker.scheduled.length;

        // Set userOverrideMs = -1500 → totalOffsetMs = 200 - 1500 = -1300 ms.
        // Expected startOffset = videoTime(2.0) - (-1.3) = 3.3
        // (which exceeds buffer duration 4s — fine, in-range)
        act(() => {
          useEditorStore.getState().setOffset(-1500);
        });
        await sleep(250);

        const afterFirstNudge = tracker.scheduled.length;
        expect(
          afterFirstNudge,
          `expected reschedule after knob change, got ${afterFirstNudge} total (baseline ${baselineCount})`,
        ).toBeGreaterThan(baselineCount);

        // The MOST RECENT schedule must reflect the new offset, not the old one.
        // For totalOffsetMs = -1300, expected startOffset = videoTime - (-1.3)
        // = videoTime + 1.3. videoTime drifts during playback, so we accept a
        // wide window around the expected delta.
        const lastSchedule = tracker.scheduled[tracker.scheduled.length - 1];
        const minBig = Math.max(0, v.currentTime + 1.3 - 0.5);
        const maxBig = Math.min(4, v.currentTime + 1.3 + 0.5);
        expect(
          lastSchedule.startOffset,
          `expected startOffset near ${(v.currentTime + 1.3).toFixed(2)}, got ${lastSchedule.startOffset}`,
        ).toBeGreaterThan(minBig);
        expect(lastSchedule.startOffset).toBeLessThan(maxBig);

        // Now move the knob back to a small value: the next reschedule
        // should reflect that new value too.
        act(() => {
          useEditorStore.getState().setOffset(0);
        });
        await sleep(250);
        const lastSchedule2 = tracker.scheduled[tracker.scheduled.length - 1];
        // Expected startOffset = videoTime - 0.2 (algo only, override = 0).
        const minSmall = Math.max(0, v.currentTime - 0.2 - 0.5);
        const maxSmall = Math.min(4, v.currentTime - 0.2 + 0.5);
        expect(
          lastSchedule2.startOffset,
          `expected startOffset near ${(v.currentTime - 0.2).toFixed(2)}, got ${lastSchedule2.startOffset}`,
        ).toBeGreaterThan(minSmall);
        expect(lastSchedule2.startOffset).toBeLessThan(maxSmall);

        unmount();
      } finally {
        tracker.restore();
        URL.revokeObjectURL(audioUrl);
      }
    },
    60_000,
  );

  it(
    "loop fine-tune story: knob turns during a running loop reschedule audio LIVE without extra play clicks",
    async () => {
      const audioUrl = URL.createObjectURL(makeStudioWavBlob());
      const tracker = trackBufferSourceCreation();
      try {
        useEditorStore.getState().loadJob({
          id: "loop-test",
          fps: 30,
          duration: 3,
          width: 320,
          height: 240,
          algoOffsetMs: 0,
          driftRatio: 1,
        });

        const { unmount } = render(<Harness audioUrl={audioUrl} />);
        await waitFor(
          () =>
            (
              window as unknown as { __harness?: { ready: boolean } }
            ).__harness?.ready === true,
          5000,
        );
        const v = (window as unknown as { __harness: { video: HTMLVideoElement } }).__harness.video;
        if (v.readyState < 1) {
          await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
        }

        // 1. User finds a spot, activates loop playback (matches the
        //    SyncTuner's "Loop 1s/2s/4s around playhead" buttons).
        v.currentTime = 1.0;
        act(() => {
          useEditorStore.getState().setLoop({ start: 0.8, end: 1.4 });
        });
        await v.play().catch(() => undefined);

        // 2. Let the loop run for a bit so the rVFC tick + reschedule loop
        //    is firing.
        await sleep(300);

        // 3. Turn the knob — this is the moment the user wants to hear an
        //    instant audio shift, with NO extra play click.
        const beforeKnob = tracker.scheduled.length;
        act(() => {
          useEditorStore.getState().setOffset(300);
        });
        await sleep(120);

        const afterFirstTurn = tracker.scheduled.length;
        expect(
          afterFirstTurn,
          `knob turn 1: expected reschedule (had ${beforeKnob}, got ${afterFirstTurn})`,
        ).toBeGreaterThan(beforeKnob);
        const last1 = tracker.scheduled[afterFirstTurn - 1];
        const expected1 = v.currentTime - 0.3;
        expect(last1.startOffset).toBeGreaterThan(expected1 - 0.5);
        expect(last1.startOffset).toBeLessThan(expected1 + 0.5);

        // 4. Turn the knob again — a SECOND live nudge mid-loop.
        const beforeKnob2 = tracker.scheduled.length;
        act(() => {
          useEditorStore.getState().setOffset(-200);
        });
        await sleep(120);

        const afterSecondTurn = tracker.scheduled.length;
        expect(
          afterSecondTurn,
          `knob turn 2: expected reschedule (had ${beforeKnob2}, got ${afterSecondTurn})`,
        ).toBeGreaterThan(beforeKnob2);
        const last2 = tracker.scheduled[afterSecondTurn - 1];
        const expected2 = v.currentTime + 0.2;
        expect(last2.startOffset).toBeGreaterThan(expected2 - 0.5);
        expect(last2.startOffset).toBeLessThan(expected2 + 0.5);

        unmount();
      } finally {
        tracker.restore();
        URL.revokeObjectURL(audioUrl);
      }
    },
    60_000,
  );

  it(
    "after pause + offset change + play, the resumed audio uses the new offset",
    async () => {
      const audioUrl = URL.createObjectURL(makeStudioWavBlob());
      const tracker = trackBufferSourceCreation();
      try {
        useEditorStore.getState().loadJob({
          id: "scrubber-test-2",
          fps: 30,
          duration: 3,
          width: 320,
          height: 240,
          algoOffsetMs: 100,
          driftRatio: 1,
        });

        const { unmount } = render(<Harness audioUrl={audioUrl} />);
        await waitFor(
          () =>
            (
              window as unknown as { __harness?: { ready: boolean } }
            ).__harness?.ready === true,
          5000,
        );
        const v = (window as unknown as { __harness: { video: HTMLVideoElement } }).__harness.video;

        if (v.readyState < 1) {
          await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
        }
        await v.play().catch(() => undefined);
        await sleep(120);
        v.pause();
        await sleep(50);

        // Knob change while paused — no schedule events expected.
        const beforeChange = tracker.scheduled.length;
        act(() => {
          useEditorStore.getState().setOffset(750);
        });
        await sleep(150);
        expect(
          tracker.scheduled.length,
          "no schedule should occur while paused",
        ).toBe(beforeChange);

        // Seek so the resumed schedule has a non-trivial startOffset.
        v.currentTime = 1.5;
        await sleep(50);
        await v.play().catch(() => undefined);
        await sleep(200);

        // After resume, the most recent schedule must use the new override.
        // totalOffsetMs = 100 + 750 = 850 → startOffset = 1.5 - 0.85 = 0.65.
        const last = tracker.scheduled[tracker.scheduled.length - 1];
        const expected = v.currentTime - 0.85;
        expect(
          last.startOffset,
          `expected startOffset near ${expected.toFixed(2)}, got ${last.startOffset}`,
        ).toBeGreaterThan(expected - 0.5);
        expect(last.startOffset).toBeLessThan(expected + 0.5);

        unmount();
      } finally {
        tracker.restore();
        URL.revokeObjectURL(audioUrl);
      }
    },
    60_000,
  );
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(pred: () => boolean, timeoutMs: number): Promise<void> {
  const start = performance.now();
  while (!pred()) {
    if (performance.now() - start > timeoutMs) {
      throw new Error("waitFor timed out");
    }
    await sleep(20);
  }
}
