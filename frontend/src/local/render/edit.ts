/**
 * Edit-render orchestrator.
 *
 * Pipeline (mirrors `app/pipeline/render_edit.py` but without the ffmpeg
 * filter-graph indirection — we do the work directly in WebCodecs):
 *
 *   1. Demux phone-video → encoded video chunks + decoder config.
 *   2. Decode + transform studio audio (drift, offset, segment cuts).
 *   3. Encode audio → AAC chunks.
 *   4. Streaming video pipeline: each decoded VideoFrame is composited
 *      and pushed straight into the encoder, then closed. Backpressure
 *      on the decode/encode queues keeps memory bounded — see the
 *      `frameQueue` history below for what we replaced.
 *   5. Mux video + audio into MP4. If `output` is provided we stream
 *      the bytes directly into a FileSystemWritableFileStream; otherwise
 *      we fall back to an in-memory buffer (used by tests).
 *
 * History: until 2026-04 the pipeline buffered every decoded VideoFrame
 * into an array (`frameQueue: VideoFrame[]`) before encoding. That
 * accumulated multi-GB of YUV data for typical 3-min 1080p videos and
 * regularly killed the browser tab. Streaming + backpressure fixes that.
 */

import {
  ArrayBufferTarget,
  FileSystemWritableFileStreamTarget,
  Muxer,
} from "mp4-muxer";

type MuxTarget = ArrayBufferTarget | FileSystemWritableFileStreamTarget;
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

export interface EditRenderProgress {
  /** "audio-decode" | "audio-encode" | "video-encode" | "muxing" */
  stage: string;
  /** Frames composited + sent to the encoder so far. */
  framesDone: number;
  /** Total frames the encoder is expected to emit (best estimate). */
  framesTotal: number;
}

export interface EditRenderInput {
  videoFile: Blob | ArrayBuffer;
  /** One of audioFile / audioPcm must be provided. audioPcm is the worker
   *  path: AudioContext.decodeAudioData is unavailable in workers, so the
   *  main thread decodes once and transfers the Float32Array. */
  audioFile?: Blob | ArrayBuffer;
  audioPcm?: { pcm: Float32Array; sampleRate: number; channels: number };
  segments: Segment[]; // empty/zero-length → use the whole clip
  overlays: TextOverlay[];
  energy?: EnergyCurves | null;
  visualizers?: Visualizer[];
  offsetMs: number;
  driftRatio: number;
  videoBitrateBps?: number;
  audioBitrateBps?: number;
  /** Stream the muxed MP4 directly into this writable. When present the
   *  caller owns the stream's lifecycle (close on success, abort on error). */
  output?: FileSystemWritableFileStream;
  /** Periodic progress notifications. Called from the decoder output
   *  callback — keep work in the handler tiny. */
  onProgress?: (p: EditRenderProgress) => void;
}

export interface EditRenderResult {
  /** In-memory MP4 bytes when `input.output` was not provided; otherwise null. */
  output: Uint8Array | null;
  width: number;
  height: number;
  videoCodec: string;
  audioBackend: "webcodecs" | "ffmpeg-wasm";
  audioSampleRate: number;
  audioChannelCount: number;
  /** Final size in bytes. Always populated. */
  byteLength: number;
}

export async function decodeStudioAudioInterleaved(
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

  // Step 2: decode + transform audio. We chain through a single binding so
  // intermediate Float32Arrays become unreachable and can be GC'd before
  // the next allocation runs. For 3 min stereo @ 48 kHz each copy is
  // ~140 MB — keeping all four around simultaneously is what caused the
  // pre-2026-04 audio-side leak.
  input.onProgress?.({ stage: "audio-decode", framesDone: 0, framesTotal: 0 });
  let audio: { pcm: Float32Array; sampleRate: number; channels: number };
  if (input.audioPcm) {
    audio = input.audioPcm;
  } else if (input.audioFile) {
    audio = await decodeStudioAudioInterleaved(input.audioFile);
  } else {
    throw new Error("editRender: either audioFile or audioPcm is required");
  }
  let pcm: Float32Array | null = audio.pcm;
  if (input.driftRatio !== 1.0) {
    const next = applyDriftStretchInterleaved(pcm, audio.channels, input.driftRatio);
    pcm = next;
  }
  if (input.offsetMs !== 0) {
    const next = applyAudioOffsetInterleaved(pcm, audio.channels, audio.sampleRate, input.offsetMs);
    pcm = next;
  }
  pcm = applySegments(pcm, audio.channels, audio.sampleRate, input.segments);

  // Step 3: encode audio.
  input.onProgress?.({ stage: "audio-encode", framesDone: 0, framesTotal: 0 });
  const encodedAudio = await encodeAacFromPcm(pcm, {
    numberOfChannels: audio.channels,
    sampleRate: audio.sampleRate,
    bitrateBps: input.audioBitrateBps ?? 192_000,
  });
  if (!encodedAudio.description) {
    throw new Error("Audio encoder produced no description");
  }
  // Drop the PCM reference — encoder copied what it needed. Frees ~half a
  // gig for a 3-min stereo source before the heavy video pipeline starts.
  pcm = null;

  // Step 4: streaming video composite + encode.
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

  const intervals: Segment[] =
    input.segments.length > 0
      ? input.segments
      : [{ in: 0, out: video.info.durationS }];

  // Estimate the total emitted-frame count from the kept duration. Used
  // only for the progress bar; off by a frame or two is fine.
  const keptDurationS = intervals.reduce((acc, s) => acc + (s.out - s.in), 0);
  const framesTotal = Math.max(1, Math.round(keptDurationS * fps));

  let nextIntervalIdx = 0;
  let firstFrameInGop = true;
  let framesEmitted = 0;
  let pendingError: Error | null = null;
  // VideoEncoder.encode is synchronous, so we can chain
  // decode → composite → encode entirely inside the decoder's output
  // callback. No frame ever lives outside this scope.
  const decoder = new VideoDecoder({
    output: (frame) => {
      try {
        const tS = frame.timestamp / 1_000_000;
        let inInterval = false;
        let intervalStartS = 0;
        for (let i = 0; i < intervals.length; i++) {
          const seg = intervals[i];
          if (tS >= seg.in && tS < seg.out) {
            inInterval = true;
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
          return;
        }
        const outTs = Math.round((tS + intervalStartS) * 1_000_000);
        const composed = compositor.composite(frame, outTs);
        encoder.pushFrame(composed, { keyFrame: firstFrameInGop });
        composed.close();
        frame.close();
        firstFrameInGop = false;
        framesEmitted++;
        if (framesEmitted % 30 === 0 || framesEmitted === framesTotal) {
          input.onProgress?.({
            stage: "video-encode",
            framesDone: framesEmitted,
            framesTotal,
          });
        }
      } catch (e) {
        pendingError = e instanceof Error ? e : new Error(String(e));
        try { frame.close(); } catch { /* already closed */ }
      }
    },
    error: (e) => {
      pendingError = e instanceof Error ? e : new Error(String(e));
    },
  });
  decoder.configure({
    codec: video.info.codec,
    codedWidth: video.info.width,
    codedHeight: video.info.height,
    description: video.info.description,
  });

  // Feed chunks with backpressure. Without this the HW decoder happily
  // outruns the (typically slower) software encoder and we accumulate
  // hundreds of in-flight VideoFrames. The thresholds (8 / 16) are
  // conservative — empirically Chromium's HW encoder pipelines around
  // 4 frames; 16 leaves headroom without bloating memory.
  for (const c of video.chunks) {
    if (pendingError) throw pendingError;
    while (decoder.decodeQueueSize > 8 || encoder.encodeQueueSize > 16) {
      await new Promise((r) => setTimeout(r, 1));
      if (pendingError) throw pendingError;
    }
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
  if (pendingError) throw pendingError;

  const encodedVideo = await encoder.finish();
  if (!encodedVideo.description) {
    throw new Error("Video encoder produced no description");
  }
  compositor.destroy();

  // Final progress tick at the encode boundary.
  input.onProgress?.({
    stage: "muxing",
    framesDone: framesEmitted,
    framesTotal,
  });

  // Step 5: mux. Stream into the caller-provided sink when given so the
  // entire MP4 never has to live in RAM. fastStart: "in-memory" is not
  // available with a streaming target — moov ends up at the tail, which
  // is fine for local OPFS playback.
  const target: MuxTarget = input.output
    ? new FileSystemWritableFileStreamTarget(input.output)
    : new ArrayBufferTarget();

  const muxer = new Muxer({
    target,
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
    fastStart: input.output ? false : "in-memory",
    firstTimestampBehavior: "offset",
  });

  const videoMeta = {
    decoderConfig: {
      codec: encodedVideo.codec,
      codedWidth: encodedVideo.width,
      codedHeight: encodedVideo.height,
      description: encodedVideo.description,
    },
  } as unknown as Parameters<Muxer<MuxTarget>["addVideoChunkRaw"]>[4];
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
  } as unknown as Parameters<Muxer<MuxTarget>["addAudioChunkRaw"]>[4];
  for (const c of encodedAudio.chunks) {
    muxer.addAudioChunkRaw(c.data, c.type, c.timestampUs, c.durationUs, audioMeta);
  }

  muxer.finalize();

  let outputBytes: Uint8Array | null = null;
  let byteLength = 0;
  if (input.output) {
    // Caller closes the writable. We only know the size if the muxer
    // exposes it on the target — FileSystemWritableFileStreamTarget
    // doesn't, so we leave byteLength at 0 here and have the caller
    // stat the file afterwards.
    byteLength = 0;
  } else {
    const buf = (target as ArrayBufferTarget).buffer;
    outputBytes = new Uint8Array(buf);
    byteLength = outputBytes.byteLength;
  }

  return {
    output: outputBytes,
    width: video.info.width,
    height: video.info.height,
    videoCodec: encodedVideo.codec,
    audioBackend: "webcodecs",
    audioSampleRate: encodedAudio.sampleRate,
    audioChannelCount: encodedAudio.numberOfChannels,
    byteLength,
  };
}
