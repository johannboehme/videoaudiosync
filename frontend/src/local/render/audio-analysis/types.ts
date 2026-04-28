/**
 * AudioAnalysis: das Ergebnis der Vorab-Analyse des Master-Audios.
 *
 * Wird einmal pro Master-Audio berechnet (Spectral-Flux Onsets,
 * Autokorrelations-Tempo, DP-Beat-Tracking nach Ellis 2007) und in IDB
 * gecacht. Reproduzierbar — gleicher PCM-Input liefert deterministisch
 * gleiche Werte. Beat-Phase + BPM treiben die Beat-Ruler-Anzeige und das
 * Snap-Grid; Onsets/Bands sind für künftige audio-reaktive Effekte
 * vorbereitet (im Editor-Sub-Feature aktuell nicht visualisiert).
 */
export interface BandSet {
  bass: number[];
  lowMids: number[];
  mids: number[];
  highs: number[];
}

export interface Tempo {
  /** Detected tempo in beats per minute. */
  bpm: number;
  /** Heuristic confidence 0..1 (peak height of the autocorrelation,
   *  normalized against the second-best peak). */
  confidence: number;
  /** Phase of beat 0 in seconds (i.e. when the first beat occurs). */
  phase: number;
}

export interface AudioAnalysis {
  version: 1;
  sampleRate: number;
  /** Total duration of the analyzed audio in seconds. */
  duration: number;
  /** Samples between consecutive analysis frames (hop). */
  hopSize: number;
  /** = sampleRate / hopSize — frames per second of the time-series fields. */
  framesPerSec: number;
  /** Per-frame energy in four logarithmic bands. Length = total frames. */
  bands: BandSet;
  /** Per-frame RMS amplitude (time-domain), smoothed. Length = total frames. */
  rms: number[];
  /** Spectral-flux onset envelope, normalized 0..1. Length = total frames. */
  onsetStrength: number[];
  /** Discrete onset times (seconds). Peak-picked from onsetStrength. */
  onsets: number[];
  /** Per-band onset times (kick / snare / hihat approximation). */
  onsetsByBand: BandSet;
  /** Detected beat times in seconds. Empty if tempo could not be detected. */
  beats: number[];
  /** Every 4th beat (4/4 assumption). */
  downbeats: number[];
  /** Tempo metadata. null when no tempo could be detected. */
  tempo: Tempo | null;
}
