/**
 * Decodes an audio file (any container the browser supports — MP4, MOV, WAV,
 * MP3, OGG, FLAC) into mono PCM at a target sample rate.
 *
 * For the sync algorithm we need the entire PCM buffer in memory anyway, so
 * `AudioContext.decodeAudioData` is the right primitive: it handles container
 * detection and codec decode in one call, with hardware acceleration when
 * available, and works in every browser we support. WebCodecs is reserved
 * for the streaming render path (Phase 3+) where in-flight VideoFrames
 * matter for memory.
 *
 * Resampling is done via `OfflineAudioContext` — fast linear/sinc resampler
 * built into the browser, good enough for sync (the sync algorithm uses
 * 22050 Hz mono throughout).
 */

export interface DecodedAudio {
  pcm: Float32Array;
  sampleRate: number;
  durationS: number;
  /** Which backend produced this PCM. */
  backend: "webcodecs" | "ffmpeg-wasm";
}

export async function decodeAudioToMonoPcm(
  source: Blob | ArrayBuffer,
  targetSampleRate: number,
): Promise<DecodedAudio> {
  const buf =
    source instanceof ArrayBuffer ? source : await source.arrayBuffer();

  // 1. Decode using a one-shot AudioContext. The decoded sample rate is the
  //    source's native rate; we resample below.
  const decodeCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  let decoded: AudioBuffer;
  try {
    decoded = await decodeCtx.decodeAudioData(buf.slice(0));
  } finally {
    await decodeCtx.close().catch(() => {});
  }

  // 2. Mix down to mono (average of all channels) at the source rate.
  const ch = decoded.numberOfChannels;
  const len = decoded.length;
  const mono = new Float32Array(len);
  if (ch === 1) {
    mono.set(decoded.getChannelData(0));
  } else {
    const channels: Float32Array[] = [];
    for (let i = 0; i < ch; i++) channels.push(decoded.getChannelData(i));
    for (let i = 0; i < len; i++) {
      let sum = 0;
      for (let c = 0; c < ch; c++) sum += channels[c][i];
      mono[i] = sum / ch;
    }
  }

  // 3. If the source rate matches the target, we're done.
  if (decoded.sampleRate === targetSampleRate) {
    return {
      pcm: mono,
      sampleRate: targetSampleRate,
      durationS: decoded.duration,
      backend: "webcodecs",
    };
  }

  // 4. Resample with OfflineAudioContext. We feed the mono buffer in,
  //    and ask for the same duration at the target rate.
  const targetLen = Math.round(len * (targetSampleRate / decoded.sampleRate));
  const offline = new OfflineAudioContext(1, targetLen, targetSampleRate);
  const sourceBuf = offline.createBuffer(1, len, decoded.sampleRate);
  sourceBuf.copyToChannel(mono, 0);
  const node = offline.createBufferSource();
  node.buffer = sourceBuf;
  node.connect(offline.destination);
  node.start(0);
  const resampled = await offline.startRendering();

  return {
    pcm: resampled.getChannelData(0).slice(),
    sampleRate: targetSampleRate,
    durationS: resampled.duration,
    backend: "webcodecs",
  };
}
