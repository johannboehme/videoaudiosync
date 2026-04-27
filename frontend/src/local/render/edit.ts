/**
 * Edit-render orchestrator.
 *
 * Pipeline (mirrors `app/pipeline/render_edit.py` but without the ffmpeg
 * filter-graph indirection — we do the work directly in WebCodecs):
 *
 *   1. Demux phone-video → encoded video chunks + decoder config.
 *   2. Decode + transform studio audio (drift, offset, segment cuts).
 *   3. Encode audio → AAC chunks.
 *   4. For each output video frame:
 *        - decode the source frame
 *        - composite (text overlays / future visualizers)
 *        - encode → H.264 chunks
 *      Done segment-by-segment when `segments` describes cuts.
 *   5. Mux video + audio chunks into MP4.
 *
 * For Phase 5 the visualizer layer is stubbed (no avectorscope etc. yet);
 * the compositor handles ASS overlays (via JASSUB if available) and is
 * extensible. See `compositor.ts`.
 */

import { ArrayBufferTarget, Muxer } from "mp4-muxer";
import { encodeAacFromPcm } from "../codec/webcodecs/audio-encode";
import { demuxVideoTrack } from "../codec/webcodecs/demux";
import { StreamingVideoEncoder } from "../codec/webcodecs/video-encode";
import {
  applyAudioOffsetInterleaved,
  applyDriftStretchInterleaved,
} from "./audio-fx";
import { Compositor } from "./compositor";
import type { TextOverlay, EnergyCurves } from "./ass-builder";
import type { Visualizer } from "./visualizer/types";

export interface Segment {
  in: number; // seconds
  out: number; // seconds
}

export interface EditRenderInput {
  videoFile: Blob | ArrayBuffer;
  audioFile: Blob | ArrayBuffer;
  segments: Segment[]; // empty/zero-length → use the whole clip
  overlays: TextOverlay[];
  energy?: EnergyCurves | null;
  visualizers?: Visualizer[];
  offsetMs: number;
  driftRatio: number;
  videoBitrateBps?: number;
  audioBitrateBps?: number;
}

export interface EditRenderResult {
  output: Uint8Array;
  width: number;
  height: number;
  videoCodec: string;
  audioBackend: "webcodecs" | "ffmpeg-wasm";
  audioSampleRate: number;
  audioChannelCount: number;
}

async function decodeStudioAudioInterleaved(
  source: Blob | ArrayBuffer,
): Promise<{ pcm: Float32Array; sampleRate: number; channels: number }> {
  const buf = source instanceof ArrayBuffer ? source : await source.arrayBuffer();
  const ctx = new (window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(buf.slice(0));
  } finally {
    await ctx.close().catch(() => {});
  }
  const ch = decoded.numberOfChannels;
  const len = decoded.length;
  const inter = new Float32Array(len * ch);
  for (let c = 0; c < ch; c++) {
    const channel = decoded.getChannelData(c);
    for (let i = 0; i < len; i++) inter[i * ch + c] = channel[i];
  }
  return { pcm: inter, sampleRate: decoded.sampleRate, channels: ch };
}

/** Trim interleaved PCM to one or more time segments and concatenate. */
function applySegments(
  pcm: Float32Array,
  channelCount: number,
  sampleRate: number,
  segments: Segment[],
): Float32Array {
  if (segments.length === 0) return pcm;
  let totalSamples = 0;
  const ranges: Array<{ start: number; end: number }> = [];
  for (const seg of segments) {
    const s = Math.max(0, Math.floor(seg.in * sampleRate)) * channelCount;
    const e =
      Math.min(pcm.length, Math.floor(seg.out * sampleRate) * channelCount);
    if (e > s) {
      ranges.push({ start: s, end: e });
      totalSamples += e - s;
    }
  }
  const out = new Float32Array(totalSamples);
  let cursor = 0;
  for (const r of ranges) {
    out.set(pcm.subarray(r.start, r.end), cursor);
    cursor += r.end - r.start;
  }
  return out;
}

export async function editRender(input: EditRenderInput): Promise<EditRenderResult> {
  // Step 1: demux video.
  const video = await demuxVideoTrack(input.videoFile);
  if (!video) throw new Error("Edit render: no video track in source.");

  // Step 2: decode + transform audio.
  const audio = await decodeStudioAudioInterleaved(input.audioFile);
  let pcm = audio.pcm;
  if (input.driftRatio !== 1.0) {
    pcm = applyDriftStretchInterleaved(pcm, audio.channels, input.driftRatio);
  }
  if (input.offsetMs !== 0) {
    pcm = applyAudioOffsetInterleaved(pcm, audio.channels, audio.sampleRate, input.offsetMs);
  }
  pcm = applySegments(pcm, audio.channels, audio.sampleRate, input.segments);

  // Step 3: encode audio.
  const encodedAudio = await encodeAacFromPcm(pcm, {
    numberOfChannels: audio.channels,
    sampleRate: audio.sampleRate,
    bitrateBps: input.audioBitrateBps ?? 192_000,
  });
  if (!encodedAudio.description) {
    throw new Error("Audio encoder produced no description");
  }

  // Step 4: video composite + encode.
  const fps = Math.max(1, Math.round(video.info.fps));
  const compositor = new Compositor({
    width: video.info.width,
    height: video.info.height,
    overlays: input.overlays,
    energy: input.energy ?? null,
    visualizers: input.visualizers ?? [],
  });
  await compositor.ensureSubtitleEngine();

  const encoder = new StreamingVideoEncoder({
    width: video.info.width,
    height: video.info.height,
    frameRate: fps,
    bitrateBps: input.videoBitrateBps ?? 4_000_000,
  });

  // Build the list of source-time intervals we want to keep (segments).
  // If segments is empty, use the whole video.
  const intervals: Segment[] =
    input.segments.length > 0
      ? input.segments
      : [{ in: 0, out: video.info.durationS }];

  // Decode the source video into VideoFrames, filter by interval, push to
  // compositor + encoder. We reuse a single VideoDecoder with a queue.
  let outputCursorUs = 0;
  let nextIntervalIdx = 0;
  let firstFrameInGop = true;

  const frameQueue: VideoFrame[] = [];
  let decoderError: Error | null = null;
  const decoder = new VideoDecoder({
    output: (frame) => {
      frameQueue.push(frame);
    },
    error: (e) => {
      decoderError = e instanceof Error ? e : new Error(String(e));
    },
  });
  decoder.configure({
    codec: video.info.codec,
    codedWidth: video.info.width,
    codedHeight: video.info.height,
    description: video.info.description,
  });

  // Feed all chunks into the decoder. WebCodecs handles the back-pressure
  // (decoder.decodeQueueSize) — for our typical 3-min videos the buffer is
  // small enough that we don't need to throttle.
  for (const c of video.chunks) {
    decoder.decode(
      new EncodedVideoChunk({
        type: c.isKey ? "key" : "delta",
        timestamp: c.timestampUs,
        duration: c.durationUs,
        data: c.data,
      }),
    );
  }
  await decoder.flush();
  decoder.close();

  if (decoderError) throw decoderError;

  // Walk frames, filter by intervals, encode.
  for (const frame of frameQueue) {
    const tS = frame.timestamp / 1_000_000;
    // Skip frames whose source time isn't within any active interval.
    let inInterval = false;
    let intervalStartS = 0;
    for (let i = 0; i < intervals.length; i++) {
      const seg = intervals[i];
      if (tS >= seg.in && tS < seg.out) {
        inInterval = true;
        // Compute cumulative interval offset for output timestamp.
        for (let j = 0; j < i; j++) {
          intervalStartS += intervals[j].out - intervals[j].in;
        }
        intervalStartS -= seg.in;
        if (i !== nextIntervalIdx) {
          nextIntervalIdx = i;
          firstFrameInGop = true;
        }
        break;
      }
    }
    if (!inInterval) {
      frame.close();
      continue;
    }

    // Compute output timestamp.
    const outTs = Math.round((tS + intervalStartS) * 1_000_000);
    outputCursorUs = outTs;
    const composed = compositor.composite(frame, outTs);
    encoder.pushFrame(composed, { keyFrame: firstFrameInGop });
    composed.close();
    frame.close();
    firstFrameInGop = false;
  }

  const encodedVideo = await encoder.finish();
  if (!encodedVideo.description) {
    throw new Error("Video encoder produced no description");
  }
  compositor.destroy();
  void outputCursorUs;

  // Step 5: mux.
  const muxer = new Muxer({
    target: new ArrayBufferTarget(),
    video: {
      codec: "avc",
      width: video.info.width,
      height: video.info.height,
      frameRate: fps,
    },
    audio: {
      codec: "aac",
      numberOfChannels: encodedAudio.numberOfChannels,
      sampleRate: encodedAudio.sampleRate,
    },
    fastStart: "in-memory",
    firstTimestampBehavior: "offset",
  });

  const videoMeta = {
    decoderConfig: {
      codec: encodedVideo.codec,
      codedWidth: encodedVideo.width,
      codedHeight: encodedVideo.height,
      description: encodedVideo.description,
    },
  } as unknown as Parameters<Muxer<ArrayBufferTarget>["addVideoChunkRaw"]>[4];
  for (const c of encodedVideo.chunks) {
    muxer.addVideoChunkRaw(c.data, c.type, c.timestampUs, c.durationUs, videoMeta);
  }

  const audioMeta = {
    decoderConfig: {
      codec: encodedAudio.codec,
      sampleRate: encodedAudio.sampleRate,
      numberOfChannels: encodedAudio.numberOfChannels,
      description: encodedAudio.description,
    },
  } as unknown as Parameters<Muxer<ArrayBufferTarget>["addAudioChunkRaw"]>[4];
  for (const c of encodedAudio.chunks) {
    muxer.addAudioChunkRaw(c.data, c.type, c.timestampUs, c.durationUs, audioMeta);
  }

  muxer.finalize();

  return {
    output: new Uint8Array((muxer.target as ArrayBufferTarget).buffer),
    width: video.info.width,
    height: video.info.height,
    videoCodec: encodedVideo.codec,
    audioBackend: "webcodecs",
    audioSampleRate: encodedAudio.sampleRate,
    audioChannelCount: encodedAudio.numberOfChannels,
  };
}
