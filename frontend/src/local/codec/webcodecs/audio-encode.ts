/**
 * Encodes a PCM Float32Array to AAC chunks via WebCodecs `AudioEncoder`.
 * Supports mono and stereo. Returns the encoder's resolved description so
 * the muxer can write the `esds` box correctly.
 */

export interface EncodedAudioChunkRecord {
  type: "key" | "delta";
  timestampUs: number;
  durationUs: number;
  data: Uint8Array;
}

export interface AudioEncodeResult {
  chunks: EncodedAudioChunkRecord[];
  /** Codec ID (e.g. "mp4a.40.2"). */
  codec: string;
  sampleRate: number;
  numberOfChannels: number;
  /** AudioSpecificConfig bytes — for the muxer's decoder config. */
  description?: Uint8Array;
}

export interface AudioEncodeOptions {
  /** Number of interleaved channels in the input (1 or 2). */
  numberOfChannels: number;
  sampleRate: number;
  bitrateBps?: number;
  /** Frame size for the encoder; AAC native frame is 1024. */
  frameSize?: number;
}

/**
 * Input PCM is laid out as INTERLEAVED frames: [L0, R0, L1, R1, ...].
 * For mono pass a Float32Array of length samples_per_channel.
 */
export async function encodeAacFromPcm(
  pcm: Float32Array,
  opts: AudioEncodeOptions,
): Promise<AudioEncodeResult> {
  const { numberOfChannels, sampleRate } = opts;
  const bitrateBps = opts.bitrateBps ?? 192_000;
  const frameSize = opts.frameSize ?? 1024;
  const samplesPerChannel = pcm.length / numberOfChannels;

  const chunks: EncodedAudioChunkRecord[] = [];
  let description: Uint8Array | undefined;

  const encoder = new AudioEncoder({
    output: (chunk, metadata) => {
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      chunks.push({
        type: chunk.type as "key" | "delta",
        timestampUs: chunk.timestamp,
        durationUs: chunk.duration ?? 0,
        data,
      });
      if (description === undefined && metadata?.decoderConfig?.description) {
        const desc = metadata.decoderConfig.description as
          | ArrayBuffer
          | ArrayBufferView;
        if (desc instanceof ArrayBuffer) {
          description = new Uint8Array(desc);
        } else {
          const view = desc as ArrayBufferView;
          description = new Uint8Array(
            view.buffer as ArrayBuffer,
            view.byteOffset,
            view.byteLength,
          );
        }
      }
    },
    error: (e) => {
      throw e;
    },
  });

  encoder.configure({
    codec: "mp4a.40.2",
    sampleRate,
    numberOfChannels,
    bitrate: bitrateBps,
  });

  // Feed the PCM in fixed-size frames so the encoder sees an even cadence.
  let cursor = 0;
  while (cursor < samplesPerChannel) {
    const frameEnd = Math.min(cursor + frameSize, samplesPerChannel);
    const frameLen = frameEnd - cursor;
    const frameData = new Float32Array(frameLen * numberOfChannels);
    // Source PCM is already interleaved.
    frameData.set(
      pcm.subarray(cursor * numberOfChannels, frameEnd * numberOfChannels),
    );
    const audioData = new AudioData({
      format: "f32",
      sampleRate,
      numberOfFrames: frameLen,
      numberOfChannels,
      timestamp: Math.round((cursor / sampleRate) * 1_000_000),
      data: frameData,
    });
    encoder.encode(audioData);
    audioData.close();
    cursor += frameLen;
  }

  await encoder.flush();
  encoder.close();

  return {
    chunks,
    codec: "mp4a.40.2",
    sampleRate,
    numberOfChannels,
    description,
  };
}
