import { describe, it, expect } from "vitest";
import { quickRender } from "./quick";
import { editRender } from "./edit";
import { demuxVideoTrack } from "../codec/webcodecs/demux";
import { decodeAudioToMonoPcm } from "../codec/webcodecs/audio-decode";

/**
 * End-to-end matrix: every combination of (input video resolution × input
 * audio container) we want to support has to round-trip through both
 * `quickRender` and `editRender` without errors and produce a playable
 * MP4 with both tracks.
 *
 * The fixtures live in `frontend/public/__test_fixtures__/` and are
 * generated with ffmpeg (see deploy/Dockerfile and the make-* commands
 * documented in README) — small files (~30 KB each) committed to the
 * repo so the matrix runs hermetically without a build step.
 */

const VIDEOS = [
  { url: "/__test_fixtures__/video-720p.mp4", width: 1280, height: 720, label: "720p landscape" },
  { url: "/__test_fixtures__/video-1080p.mp4", width: 1920, height: 1080, label: "1080p landscape" },
  { url: "/__test_fixtures__/video-portrait-1080.mp4", width: 1080, height: 1920, label: "1080×1920 portrait (phone)" },
  { url: "/__test_fixtures__/video-tall-1392.mp4", width: 1392, height: 1872, label: "1392×1872 (the regression)" },
] as const;

const AUDIOS = [
  { url: "/__test_fixtures__/studio-aac.m4a", label: "AAC (m4a)" },
  { url: "/__test_fixtures__/studio-mp3.mp3", label: "MP3" },
  { url: "/__test_fixtures__/tone-3s.mp4", label: "AAC inside MP4 video" },
] as const;

async function fetchBlob(url: string): Promise<Blob> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`fixture missing: ${url} (${r.status})`);
  return await r.blob();
}

async function assertOutputIsValidMp4(
  output: Uint8Array,
  expectedWidth: number,
  expectedHeight: number,
): Promise<void> {
  expect(output.byteLength).toBeGreaterThan(1000);
  const reparsed = await demuxVideoTrack(new Blob([output as BlobPart]));
  expect(reparsed, "output must be a parseable MP4 with a video track").not.toBeNull();
  expect(reparsed!.info.width).toBe(expectedWidth);
  expect(reparsed!.info.height).toBe(expectedHeight);
  // Audio must round-trip: decode should not throw and should produce a
  // non-empty buffer.
  const audio = await decodeAudioToMonoPcm(new Blob([output as BlobPart]), 22050);
  expect(audio.pcm.length).toBeGreaterThan(0);
}

describe("render format matrix — every supported video × audio combination round-trips", () => {
  for (const v of VIDEOS) {
    describe(v.label, () => {
      for (const a of AUDIOS) {
        it(
          `quickRender with ${a.label}`,
          async () => {
            const [video, audio] = await Promise.all([fetchBlob(v.url), fetchBlob(a.url)]);
            const result = await quickRender({
              videoFile: video,
              audioFile: audio,
              offsetMs: 0,
              driftRatio: 1.0,
            });
            expect(result.width).toBe(v.width);
            expect(result.height).toBe(v.height);
            await assertOutputIsValidMp4(result.output, v.width, v.height);
          },
          120_000,
        );

        it(
          `editRender with ${a.label} (no overlays, no visualizers)`,
          async () => {
            const [video, audio] = await Promise.all([fetchBlob(v.url), fetchBlob(a.url)]);
            const result = await editRender({
              videoFile: video,
              audioFile: audio,
              segments: [],
              overlays: [],
              offsetMs: 0,
              driftRatio: 1.0,
            });
            expect(result.width).toBe(v.width);
            expect(result.height).toBe(v.height);
            await assertOutputIsValidMp4(result.output, v.width, v.height);
          },
          180_000,
        );
      }
    });
  }
});
