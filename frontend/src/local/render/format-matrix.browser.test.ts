import { describe, it, expect } from "vitest";
import { quickRender } from "./quick";
import { editRender } from "./edit";
import { demuxVideoTrack } from "../codec/webcodecs/demux";
import { decodeAudioToMonoPcm } from "../codec/webcodecs/audio-decode";
import { isVideoCodecSupported } from "../codec/webcodecs/video-encode";

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
            expect(result.output).not.toBeNull();
            await assertOutputIsValidMp4(result.output!, v.width, v.height);
          },
          180_000,
        );
      }
    });
  }
});

/**
 * Export options matrix: validates the user-facing axes — resolution
 * scaling, H.265, Opus — that the new export panel exposes. Uses a small
 * fixed video × audio pair to keep the suite in single-digit minutes.
 */
describe("editRender export options — resolution × video codec × audio codec", () => {
  const VIDEO = "/__test_fixtures__/video-720p.mp4"; // 1280×720, ~3s
  const AUDIO = "/__test_fixtures__/studio-aac.m4a";

  it(
    "down-scales 720p source to 480p output",
    async () => {
      const [video, audio] = await Promise.all([fetchBlob(VIDEO), fetchBlob(AUDIO)]);
      const result = await editRender({
        videoFile: video,
        audioFile: audio,
        segments: [],
        overlays: [],
        offsetMs: 0,
        driftRatio: 1.0,
        outputWidth: 854,
        outputHeight: 480,
      });
      expect(result.width).toBe(854);
      expect(result.height).toBe(480);
      await assertOutputIsValidMp4(result.output!, 854, 480);
    },
    180_000,
  );

  it(
    "up-scales 720p source to 1080p output (aspect-preserving)",
    async () => {
      const [video, audio] = await Promise.all([fetchBlob(VIDEO), fetchBlob(AUDIO)]);
      const result = await editRender({
        videoFile: video,
        audioFile: audio,
        segments: [],
        overlays: [],
        offsetMs: 0,
        driftRatio: 1.0,
        outputWidth: 1920,
        outputHeight: 1080,
      });
      expect(result.width).toBe(1920);
      expect(result.height).toBe(1080);
      await assertOutputIsValidMp4(result.output!, 1920, 1080);
    },
    180_000,
  );

  it(
    "H.265 either renders to hev1/hvc1 or throws a clear capability error (no silent fallback)",
    async () => {
      const [video, audio] = await Promise.all([fetchBlob(VIDEO), fetchBlob(AUDIO)]);
      const supported = await isVideoCodecSupported("h265", 1280, 720, 30);
      if (!supported) {
        // The "no silent fallback" contract: when H.265 is unavailable we
        // throw with a UI-presentable message. Test that path explicitly so
        // the contract can't quietly drift into a fallback.
        await expect(
          editRender({
            videoFile: video,
            audioFile: audio,
            segments: [],
            overlays: [],
            offsetMs: 0,
            driftRatio: 1.0,
            videoCodec: "h265",
          }),
        ).rejects.toThrow(/H\.265/);
        return;
      }
      const result = await editRender({
        videoFile: video,
        audioFile: audio,
        segments: [],
        overlays: [],
        offsetMs: 0,
        driftRatio: 1.0,
        videoCodec: "h265",
      });
      expect(result.videoCodec.startsWith("hev1") || result.videoCodec.startsWith("hvc1")).toBe(true);
      const reparsed = await demuxVideoTrack(new Blob([result.output! as BlobPart]));
      expect(reparsed).not.toBeNull();
      expect(reparsed!.info.width).toBe(1280);
      expect(reparsed!.info.height).toBe(720);
      expect(reparsed!.info.codec.startsWith("hev1") || reparsed!.info.codec.startsWith("hvc1"))
        .toBe(true);
    },
    180_000,
  );

  it(
    "renders Opus audio — output decodes back to non-empty PCM",
    async () => {
      const [video, audio] = await Promise.all([fetchBlob(VIDEO), fetchBlob(AUDIO)]);
      const result = await editRender({
        videoFile: video,
        audioFile: audio,
        segments: [],
        overlays: [],
        offsetMs: 0,
        driftRatio: 1.0,
        audioCodec: "opus",
      });
      expect(result.output).not.toBeNull();
      // Audio decode must round-trip (decodeAudioToMonoPcm handles the
      // fallback to ffmpeg.wasm if WebCodecs's decoder for Opus-in-MP4
      // ever rejects, so this is also a fallback-path smoke).
      const pcm = await decodeAudioToMonoPcm(new Blob([result.output! as BlobPart]), 22050);
      expect(pcm.pcm.length).toBeGreaterThan(0);
    },
    180_000,
  );
});
