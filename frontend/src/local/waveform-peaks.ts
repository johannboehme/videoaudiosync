/**
 * Compute the timeline waveform peaks the existing Editor expects.
 * The backend produced an array of `[min, max]` pairs at a fixed bucket
 * count; we replicate that shape from any PCM input.
 */

export interface WaveformPeaks {
  peaks: [number, number][];
  duration: number;
  sampleRate: number;
}

const DEFAULT_BUCKET_COUNT = 1500;

export function computeWaveformPeaks(
  pcm: Float32Array,
  sampleRate: number,
  bucketCount = DEFAULT_BUCKET_COUNT,
): WaveformPeaks {
  const total = pcm.length;
  const duration = total / sampleRate;
  if (total === 0 || bucketCount <= 0) {
    return { peaks: [], duration, sampleRate };
  }
  const bucketSize = Math.max(1, Math.floor(total / bucketCount));
  const usable = bucketSize * bucketCount;
  const peaks: [number, number][] = [];
  for (let b = 0; b < bucketCount; b++) {
    const start = b * bucketSize;
    const end = Math.min(usable, start + bucketSize);
    let lo = 0;
    let hi = 0;
    for (let i = start; i < end; i++) {
      const v = pcm[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    peaks.push([lo, hi]);
  }
  return { peaks, duration, sampleRate };
}
