//! 12-bin chroma feature extraction.
//!
//! We compute a pseudo-chroma (NOT a true Constant-Q transform): take an STFT
//! of the audio, compute the magnitude per frequency bin, fold each bin into
//! one of 12 pitch classes (A=0, A#=1, ..., G#=11), then L2-normalize per
//! frame for cosine-correlation friendliness.
//!
//! This is an approximation of `librosa.feature.chroma_cqt` but uses STFT
//! instead of CQT. For the sync algorithm's tolerances (±50 ms offset) this
//! is sufficient, as the goldfile tests in the frontend will validate.
//!
//! Conventions match the backend (`app/pipeline/sync.py:_chroma_features`):
//!   * sample rate: 22050 Hz
//!   * hop length: 512 samples
//!   * window: Hann, n_fft = 2048
//!   * output: 12 × T matrix, row-major, L2-normalized per frame.

use realfft::RealFftPlanner;

pub const HOP: usize = 512;
pub const N_FFT: usize = 2048;
pub const N_PITCH_CLASSES: usize = 12;

/// Returns a 12 × T row-major matrix as a flat Vec<f32>.
pub fn chroma_features(y: &[f32], sr: u32) -> ChromaMatrix {
    if y.len() < N_FFT {
        return ChromaMatrix {
            data: Vec::new(),
            n_frames: 0,
        };
    }
    let n_frames = (y.len() - N_FFT) / HOP + 1;
    if n_frames == 0 {
        return ChromaMatrix {
            data: Vec::new(),
            n_frames: 0,
        };
    }

    // Pre-compute Hann window.
    let mut window = vec![0.0f32; N_FFT];
    for i in 0..N_FFT {
        let arg = std::f32::consts::PI * (i as f32) / ((N_FFT - 1) as f32);
        window[i] = arg.sin().powi(2); // sin^2 = (1-cos)/2 = Hann
    }

    // Pre-compute frequency → pitch class mapping. We skip bins below ~30 Hz
    // (sub-audible / DC) and above Nyquist - margin.
    // Frequency for FFT bin k: f = k * sr / N_FFT
    let n_bins = N_FFT / 2 + 1;
    let mut bin_to_class: Vec<i32> = vec![-1; n_bins];
    let bin_hz = sr as f32 / N_FFT as f32;
    let a4_hz = 440.0_f32;
    for k in 1..n_bins {
        let f = (k as f32) * bin_hz;
        if !(30.0..=8000.0).contains(&f) {
            continue;
        }
        // MIDI note number relative to A4 (note 69 in MIDI):
        //   note = 12 * log2(f/440) + 69
        // Pitch class is note % 12, with class 0 = C (so we shift by 9).
        let semis = 12.0 * (f / a4_hz).log2();
        let note = (semis.round() as i32) + 69;
        let class = ((note % 12) + 12) % 12; // ensure [0,12)
        bin_to_class[k] = class;
    }

    // FFT planner.
    let mut planner: RealFftPlanner<f32> = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(N_FFT);
    let mut input = r2c.make_input_vec();
    let mut output = r2c.make_output_vec();

    let mut data = vec![0.0f32; N_PITCH_CLASSES * n_frames];

    for frame in 0..n_frames {
        let start = frame * HOP;
        let end = start + N_FFT;
        if end > y.len() {
            break;
        }
        // Window-multiply.
        for i in 0..N_FFT {
            input[i] = y[start + i] * window[i];
        }

        r2c.process(&mut input, &mut output)
            .expect("FFT should succeed for fixed-size input");

        // Magnitude → pitch-class accumulation.
        let mut bins = [0.0f32; N_PITCH_CLASSES];
        for k in 1..n_bins {
            let class = bin_to_class[k];
            if class < 0 {
                continue;
            }
            let re = output[k].re;
            let im = output[k].im;
            let mag = (re * re + im * im).sqrt();
            bins[class as usize] += mag;
        }

        // L2-normalize.
        let mut norm = 0.0f32;
        for &b in bins.iter() {
            norm += b * b;
        }
        norm = norm.sqrt();
        if norm < 1e-9 {
            for c in 0..N_PITCH_CLASSES {
                data[c * n_frames + frame] = 0.0;
            }
        } else {
            for c in 0..N_PITCH_CLASSES {
                data[c * n_frames + frame] = bins[c] / norm;
            }
        }
    }

    ChromaMatrix { data, n_frames }
}

/// 12 × T chroma matrix, row-major: row c, column t at index `c * n_frames + t`.
#[derive(Debug, Clone)]
pub struct ChromaMatrix {
    pub data: Vec<f32>,
    pub n_frames: usize,
}

impl ChromaMatrix {
    pub fn row(&self, c: usize) -> &[f32] {
        &self.data[c * self.n_frames..(c + 1) * self.n_frames]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Synthetic A=440 Hz tone should produce most energy in pitch class 9 (A).
    #[test]
    fn pure_tone_concentrates_in_one_pitch_class() {
        let sr = 22050;
        let secs = 2.0;
        let n = (sr as f32 * secs) as usize;
        let mut y = vec![0.0f32; n];
        let f = 440.0f32;
        for i in 0..n {
            y[i] = (2.0 * std::f32::consts::PI * f * (i as f32) / sr as f32).sin() * 0.5;
        }
        let chroma = chroma_features(&y, sr);
        assert!(chroma.n_frames > 0);

        // Check the middle frame.
        let mid = chroma.n_frames / 2;
        let mut max_class = 0usize;
        let mut max_val = 0.0f32;
        for c in 0..N_PITCH_CLASSES {
            let v = chroma.row(c)[mid];
            if v > max_val {
                max_val = v;
                max_class = c;
            }
        }
        // A4 = pitch class 9 in our scheme (A is 9 semitones above C).
        assert_eq!(max_class, 9, "expected A (class 9), got class {}", max_class);
        // L2-norm per frame should be ~1.
        let mut norm_sq = 0.0f32;
        for c in 0..N_PITCH_CLASSES {
            let v = chroma.row(c)[mid];
            norm_sq += v * v;
        }
        assert!((norm_sq - 1.0).abs() < 1e-3, "norm_sq = {}", norm_sq);
    }

    #[test]
    fn empty_input_produces_empty_matrix() {
        let chroma = chroma_features(&[], 22050);
        assert_eq!(chroma.n_frames, 0);
        assert!(chroma.data.is_empty());
    }

    #[test]
    fn very_short_input_produces_empty_matrix() {
        let y = vec![0.0f32; N_FFT - 1];
        let chroma = chroma_features(&y, 22050);
        assert_eq!(chroma.n_frames, 0);
    }
}
