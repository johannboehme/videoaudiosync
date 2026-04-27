/**
 * Pure audio transforms applied to PCM before encoding.
 *
 *   * `applyAudioOffset` — implements ffmpeg `adelay` (positive offset →
 *     prepend silence) and the trim-from-start case for negative offset.
 *   * `applyDriftStretch` — implements ffmpeg `atempo` for small drift
 *     ratios (typically < 0.5%). It uses linear-interpolation resampling,
 *     which acts as a tiny pitch shift; the pitch shift is sub-cent and
 *     inaudible in the drift range we encounter. For drifts > ~0.5%
 *     we'll lazy-load soundtouchjs (Phase 5).
 */

export function applyAudioOffset(
  pcm: Float32Array,
  sampleRate: number,
  offsetMs: number,
): Float32Array {
  if (offsetMs === 0) return pcm;
  const sampleShift = Math.round((offsetMs * sampleRate) / 1000);

  if (sampleShift > 0) {
    // Studio is delayed → pad with silence at the start.
    const out = new Float32Array(pcm.length + sampleShift);
    out.set(pcm, sampleShift);
    return out;
  }
  // Studio is earlier → trim from the start.
  const trim = -sampleShift;
  if (trim >= pcm.length) return new Float32Array(0);
  return pcm.slice(trim);
}

export function applyDriftStretch(pcm: Float32Array, driftRatio: number): Float32Array {
  if (driftRatio === 1.0 || Math.abs(driftRatio - 1.0) < 1e-9) return pcm;
  const targetLen = Math.round(pcm.length * driftRatio);
  if (targetLen <= 0) return new Float32Array(0);
  const out = new Float32Array(targetLen);
  const ratio = (pcm.length - 1) / (targetLen - 1 || 1);
  for (let i = 0; i < targetLen; i++) {
    const x = i * ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(x0 + 1, pcm.length - 1);
    const frac = x - x0;
    out[i] = pcm[x0] * (1 - frac) + pcm[x1] * frac;
  }
  return out;
}

/** Drift-stretch on interleaved multi-channel PCM. */
export function applyDriftStretchInterleaved(
  pcm: Float32Array,
  channelCount: number,
  driftRatio: number,
): Float32Array {
  if (channelCount <= 1) return applyDriftStretch(pcm, driftRatio);
  if (driftRatio === 1.0 || Math.abs(driftRatio - 1.0) < 1e-9) return pcm;
  const samplesPerChannel = pcm.length / channelCount;
  const targetSamplesPerChannel = Math.round(samplesPerChannel * driftRatio);
  if (targetSamplesPerChannel <= 0) return new Float32Array(0);
  const out = new Float32Array(targetSamplesPerChannel * channelCount);
  const ratio = (samplesPerChannel - 1) / (targetSamplesPerChannel - 1 || 1);
  for (let i = 0; i < targetSamplesPerChannel; i++) {
    const x = i * ratio;
    const x0 = Math.floor(x);
    const x1 = Math.min(x0 + 1, samplesPerChannel - 1);
    const frac = x - x0;
    for (let c = 0; c < channelCount; c++) {
      out[i * channelCount + c] =
        pcm[x0 * channelCount + c] * (1 - frac) + pcm[x1 * channelCount + c] * frac;
    }
  }
  return out;
}

/** Audio offset on interleaved multi-channel PCM. */
export function applyAudioOffsetInterleaved(
  pcm: Float32Array,
  channelCount: number,
  sampleRate: number,
  offsetMs: number,
): Float32Array {
  if (offsetMs === 0) return pcm;
  if (channelCount <= 1) return applyAudioOffset(pcm, sampleRate, offsetMs);
  const sampleShiftPerChannel = Math.round((offsetMs * sampleRate) / 1000);
  if (sampleShiftPerChannel > 0) {
    const padFrames = sampleShiftPerChannel * channelCount;
    const out = new Float32Array(pcm.length + padFrames);
    out.set(pcm, padFrames);
    return out;
  }
  const trimFrames = -sampleShiftPerChannel * channelCount;
  if (trimFrames >= pcm.length) return new Float32Array(0);
  return pcm.slice(trimFrames);
}
