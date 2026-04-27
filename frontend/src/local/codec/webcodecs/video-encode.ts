/**
 * Encodes a stream of `VideoFrame`s to H.264 chunks via WebCodecs
 * `VideoEncoder`. Mirror of `audio-encode.ts` for video.
 *
 * Caller passes frames via `pushFrame` and finalises with `flush`. The
 * resulting chunks list is suitable for `mp4-muxer.addVideoChunkRaw`.
 */

import { avcCodecForResolution } from "./avc-level";

export interface EncodedVideoChunkRecord {
  type: "key" | "delta";
  timestampUs: number;
  durationUs: number;
  data: Uint8Array;
}

export interface VideoEncodeResult {
  chunks: EncodedVideoChunkRecord[];
  codec: string;
  width: number;
  height: number;
  description?: Uint8Array;
}

export interface VideoEncodeOptions {
  width: number;
  height: number;
  frameRate: number;
  /** H.264 codec string. Default: Constrained Baseline at the lowest level
   * that fits the requested resolution + framerate (computed at runtime —
   * a hardcoded default like 3.1 caps out at 1280×720). */
  codec?: string;
  bitrateBps?: number;
}

export class StreamingVideoEncoder {
  private encoder: VideoEncoder;
  private chunks: EncodedVideoChunkRecord[] = [];
  private description?: Uint8Array;
  private err: Error | null = null;
  private opts: VideoEncodeOptions;

  constructor(opts: VideoEncodeOptions) {
    this.opts = {
      ...opts,
      codec: opts.codec ?? avcCodecForResolution(opts.width, opts.height, opts.frameRate),
    };
    this.encoder = new VideoEncoder({
      output: (chunk, metadata) => {
        const data = new Uint8Array(chunk.byteLength);
        chunk.copyTo(data);
        this.chunks.push({
          type: chunk.type as "key" | "delta",
          timestampUs: chunk.timestamp,
          durationUs: chunk.duration ?? 0,
          data,
        });
        if (this.description === undefined && metadata?.decoderConfig?.description) {
          const desc = metadata.decoderConfig.description as
            | ArrayBuffer
            | ArrayBufferView;
          if (desc instanceof ArrayBuffer) {
            this.description = new Uint8Array(desc);
          } else {
            const view = desc as ArrayBufferView;
            this.description = new Uint8Array(
              view.buffer as ArrayBuffer,
              view.byteOffset,
              view.byteLength,
            );
          }
        }
      },
      error: (e) => {
        this.err = e instanceof Error ? e : new Error(String(e));
      },
    });

    this.encoder.configure({
      codec: this.opts.codec!,
      width: opts.width,
      height: opts.height,
      bitrate: opts.bitrateBps ?? 4_000_000,
      framerate: opts.frameRate,
      avc: { format: "avc" }, // emit AVCC in description (mp4-muxer expects this)
    });
  }

  /**
   * Encode one frame. The caller MUST close the frame after this returns.
   * Indicate keyframes explicitly for the first frame and at GOP boundaries.
   */
  pushFrame(frame: VideoFrame, options: { keyFrame?: boolean } = {}): void {
    if (this.err) throw this.err;
    this.encoder.encode(frame, options);
  }

  /** Number of frames queued internally by the WebCodecs encoder. Used by
   * the render pipeline to apply backpressure and avoid runaway memory. */
  get encodeQueueSize(): number {
    return this.encoder.encodeQueueSize;
  }

  async finish(): Promise<VideoEncodeResult> {
    await this.encoder.flush();
    if (this.err) throw this.err;
    this.encoder.close();
    return {
      chunks: this.chunks,
      codec: this.opts.codec!,
      width: this.opts.width,
      height: this.opts.height,
      description: this.description,
    };
  }
}
