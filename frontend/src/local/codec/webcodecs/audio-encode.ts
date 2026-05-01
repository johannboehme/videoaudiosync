/**
 * Encodes a PCM Float32Array to AAC or Opus chunks via WebCodecs
 * `AudioEncoder`. Supports mono and stereo. Returns the encoder's resolved
 * description so the muxer can write the `esds` / `dOps` box correctly.
 */

export type AudioEncodeCodec = "aac" | "opus";

const CODEC_STRING: Record<AudioEncodeCodec, string> = {
  aac: "mp4a.40.2",
  opus: "opus",
};

/**
 * Probe whether the runtime can encode this codec/format. The only
 * authoritative signal is `AudioEncoder.isConfigSupported` — UA strings
 * lie. iOS Safari ships AudioEncoder but historically only supports
 * Opus encoding (no AAC); without a probe we'd silently produce a file
 * with an audio track header but no audio data, which is exactly the
 * "exported file has no audio" symptom phones hit.
 *
 * Returns `false` for any rejection (no AudioEncoder, codec name
 * unknown, sample-rate / channel combo unsupported) so the caller can
 * decide whether to fall back to a different codec.
 */
export async function isAudioCodecSupported(
  codec: AudioEncodeCodec,
  sampleRate: number,
  numberOfChannels: number,
  bitrateBps: number = 128_000,
): Promise<boolean> {
  if (typeof AudioEncoder === "undefined") return false;
  try {
    const r = await AudioEncoder.isConfigSupported({
      codec: CODEC_STRING[codec],
      sampleRate,
      numberOfChannels,
      bitrate: bitrateBps,
    });
    return r.supported === true;
  } catch {
    return false;
  }
}

export interface EncodedAudioChunkRecord {
  type: "key" | "delta";
  timestampUs: number;
  durationUs: number;
  data: Uint8Array;
}

export interface AudioEncodeResult {
  chunks: EncodedAudioChunkRecord[];
  /** Codec ID — either WebCodecs ("opus") or AAC ("mp4a.40.2"). */
  codec: string;
  /** Container codec key consumed by mp4-muxer. */
  muxerCodec: "aac" | "opus";
  sampleRate: number;
  numberOfChannels: number;
  /** AudioSpecificConfig (AAC) or DOps payload (Opus) bytes. */
  description?: Uint8Array;
}

export interface AudioEncodeOptions {
  /** Number of interleaved channels in the input (1 or 2). */
  numberOfChannels: number;
  sampleRate: number;
  bitrateBps?: number;
  /** Frame size for the encoder; AAC native frame is 1024, Opus 960. */
  frameSize?: number;
  /** Codec to encode with. Default: AAC (compat). */
  codec?: AudioEncodeCodec;
}

/**
 * Input PCM is laid out as INTERLEAVED frames: [L0, R0, L1, R1, ...].
 * For mono pass a Float32Array of length samples_per_channel.
 *
 * Codec resolution:
 *   - If `opts.codec` is given and the runtime supports it, we use it.
 *   - If it's given but unsupported (most common case: iOS Safari +
 *     "aac"), we fall back to the OTHER codec automatically. The export
 *     wrapper passes the resolved codec through to the muxer via
 *     `result.muxerCodec`, so the MP4 stays internally consistent.
 *   - If neither codec is supported we throw with a clear message that
 *     names the runtime, so the failure surfaces in the UI instead of
 *     producing a file with a registered audio track but zero data
 *     chunks (the literal "exported file has no audio" bug).
 *
 * The encoder's async error callback used to `throw e` — that does
 * nothing useful (it's swallowed by the WebCodecs error queue) and let
 * mid-stream encode failures slip through silently. We now capture the
 * error into a closure variable and re-throw after `flush()`.
 */
export async function encodeAudioFromPcm(
  pcm: Float32Array,
  opts: AudioEncodeOptions,
): Promise<AudioEncodeResult> {
  const { numberOfChannels, sampleRate } = opts;
  const requestedCodec: AudioEncodeCodec = opts.codec ?? "aac";
  const bitrateBps = opts.bitrateBps ?? 192_000;

  // Resolve a codec the runtime can actually encode. Probe the requested
  // codec first; if unsupported, try the other one before giving up.
  let codec: AudioEncodeCodec | null = null;
  if (await isAudioCodecSupported(requestedCodec, sampleRate, numberOfChannels, bitrateBps)) {
    codec = requestedCodec;
  } else {
    const fallback: AudioEncodeCodec = requestedCodec === "aac" ? "opus" : "aac";
    if (await isAudioCodecSupported(fallback, sampleRate, numberOfChannels, bitrateBps)) {
      codec = fallback;
    }
  }
  if (codec === null) {
    throw new Error(
      `AudioEncoder: this browser cannot encode AAC or Opus audio at ` +
        `${sampleRate} Hz / ${numberOfChannels} ch. The exported file would ` +
        `have a registered audio track with no data — refusing to render. ` +
        `Try a desktop browser (Chrome / Edge / recent Safari) for now.`,
    );
  }

  // Opus's native frame is 960 samples (20 ms @ 48 kHz). AAC is 1024.
  const frameSize = opts.frameSize ?? (codec === "opus" ? 960 : 1024);
  const samplesPerChannel = pcm.length / numberOfChannels;

  const chunks: EncodedAudioChunkRecord[] = [];
  let description: Uint8Array | undefined;
  let captured: Error | null = null;

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
    // Throwing from inside this callback is a no-op — the WebCodecs
    // pipeline simply swallows it, so any mid-stream encode error used
    // to disappear and we'd silently return an under-filled (or empty)
    // chunks array. Capture instead and re-throw after flush().
    error: (e) => {
      captured = e instanceof Error ? e : new Error(String(e));
    },
  });

  const codecString = CODEC_STRING[codec];
  encoder.configure({
    codec: codecString,
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

  if (captured) {
    throw new Error(`AudioEncoder failed mid-stream: ${(captured as Error).message}`);
  }

  // Sanity-check: an encoder that "configured" successfully but emitted
  // zero chunks is the exact "no audio in the file" failure mode we
  // refuse to silently ship. Same for a missing decoder description —
  // the muxer needs it to write `esds` / `dOps` for the audio track.
  if (chunks.length === 0) {
    throw new Error(
      `AudioEncoder produced 0 chunks for ${pcm.length} PCM samples ` +
        `(codec=${codecString}, sr=${sampleRate}, ch=${numberOfChannels}). ` +
        `The export would have a silent audio track — aborting.`,
    );
  }
  if (!description) {
    throw new Error(
      `AudioEncoder produced no decoder description for ${codecString}. ` +
        `Cannot mux without it.`,
    );
  }

  return {
    chunks,
    codec: codecString,
    muxerCodec: codec,
    sampleRate,
    numberOfChannels,
    description,
  };
}

/**
 * @deprecated AAC-specific entry kept for callers that don't care about
 *  the codec choice. New code should use `encodeAudioFromPcm`.
 */
export async function encodeAacFromPcm(
  pcm: Float32Array,
  opts: Omit<AudioEncodeOptions, "codec">,
): Promise<AudioEncodeResult> {
  return encodeAudioFromPcm(pcm, { ...opts, codec: "aac" });
}
