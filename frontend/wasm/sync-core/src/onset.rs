//! Spectral-flux onset envelope.
//!
//! Onset detection complements chroma — chroma captures harmonic identity
//! ("which notes are sounding") while onset captures temporal events
//! ("when something starts"). For repetitive music the chroma matrix
//! self-correlates strongly at every bar boundary, so cross-correlating
//! it can pick a wrong-but-locally-similar lag. Onset envelopes are far
//! more discriminative in time because each transient is unique.
//!
//! Algorithm:
//!   1. STFT (n_fft=2048, hop=512, Hann), same window we already use for
//!      chroma — keeps the FFT planner shareable.
//!   2. For each frame, compute the per-bin half-wave-rectified spectral
//!      flux (max(0, |X[t,k]| - |X[t-1,k]|)) and sum across bins.
//!   3. Subtract a local moving-average baseline so the envelope hugs
//!      zero between transients (helps the cross-correlation find
//!      sharper peaks).
//!
//! Output: a single Vec<f32> of length n_frames. Cross-correlate two of
//! these to align two recordings of the same source.

use realfft::RealFftPlanner;

pub const HOP: usize = 512;
pub const N_FFT: usize = 2048;

/// Window length (in frames) of the moving-average baseline subtracted
/// from the raw flux. ~25 frames @ hop 512 / 22050 Hz ≈ 0.58 s — long
/// enough to ignore individual notes, short enough to track tempo
/// changes.
const BASELINE_FRAMES: usize = 25;

pub fn onset_envelope(y: &[f32], _sr: u32) -> Vec<f32> {
    if y.len() < N_FFT {
        return Vec::new();
    }
    let n_frames = (y.len() - N_FFT) / HOP + 1;
    if n_frames < 2 {
        return Vec::new();
    }

    // Hann window (matches chroma.rs's window for FFT planner reuse).
    let mut window = vec![0.0f32; N_FFT];
    for i in 0..N_FFT {
        let arg = std::f32::consts::PI * (i as f32) / ((N_FFT - 1) as f32);
        window[i] = arg.sin().powi(2);
    }

    let mut planner: RealFftPlanner<f32> = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(N_FFT);
    let mut input = r2c.make_input_vec();
    let mut output = r2c.make_output_vec();

    let n_bins = N_FFT / 2 + 1;
    let mut prev_mag = vec![0.0f32; n_bins];
    let mut flux = vec![0.0f32; n_frames];

    for frame in 0..n_frames {
        let start = frame * HOP;
        let end = start + N_FFT;
        if end > y.len() {
            break;
        }
        for i in 0..N_FFT {
            input[i] = y[start + i] * window[i];
        }
        r2c.process(&mut input, &mut output).expect("fft");

        let mut frame_flux = 0.0f32;
        for k in 0..n_bins {
            let re = output[k].re;
            let im = output[k].im;
            let mag = (re * re + im * im).sqrt();
            // Half-wave rectified flux: only count increases in magnitude.
            let diff = mag - prev_mag[k];
            if diff > 0.0 {
                frame_flux += diff;
            }
            prev_mag[k] = mag;
        }
        flux[frame] = frame_flux;
    }

    // Subtract a local moving-average baseline. Implemented via a sliding
    // sum to stay O(n) — important since this runs on full-length audio.
    let mut envelope = vec![0.0f32; n_frames];
    let half = BASELINE_FRAMES / 2;
    let mut win_sum = 0.0f32;
    for i in 0..n_frames {
        // Push frame into the trailing window.
        let push_idx = i;
        win_sum += flux[push_idx];
        // Pop the frame that fell off the leading edge.
        if push_idx >= BASELINE_FRAMES {
            win_sum -= flux[push_idx - BASELINE_FRAMES];
        }
        let window_size = (push_idx + 1).min(BASELINE_FRAMES);
        let baseline = win_sum / window_size as f32;
        // Center the baseline on `i - half` (lag a touch to keep peaks aligned).
        let center = if i >= half { i - half } else { 0 };
        envelope[center] = (flux[center] - baseline).max(0.0);
    }

    envelope
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    #[test]
    fn empty_input_yields_empty_envelope() {
        assert!(onset_envelope(&[], 22050).is_empty());
        assert!(onset_envelope(&vec![0.0f32; N_FFT - 1], 22050).is_empty());
    }

    #[test]
    fn click_train_produces_periodic_envelope_peaks() {
        let sr = 22050u32;
        let secs = 4.0;
        let n = (sr as f32 * secs) as usize;
        let mut y = vec![0.0f32; n];
        // Click every 0.5 s.
        let click_period = 0.5;
        let click_len = (0.005 * sr as f32) as usize;
        let mut t = click_period;
        while t < secs {
            let start = (t * sr as f32) as usize;
            for i in 0..click_len {
                let idx = start + i;
                if idx >= n {
                    break;
                }
                let env = (1.0 - i as f32 / click_len as f32).max(0.0);
                y[idx] = env * 0.8 * (2.0 * PI * 2000.0 * (i as f32 / sr as f32)).sin();
            }
            t += click_period;
        }
        let env = onset_envelope(&y, sr);
        assert!(!env.is_empty());
        // Find the indices of envelope peaks above some threshold.
        let max_val = env.iter().cloned().fold(0.0_f32, f32::max);
        let thresh = max_val * 0.4;
        let mut peak_frames: Vec<usize> = Vec::new();
        for i in 1..env.len() - 1 {
            if env[i] > thresh && env[i] > env[i - 1] && env[i] >= env[i + 1] {
                peak_frames.push(i);
            }
        }
        // At least 4 clicks should produce 4+ peaks (some may be merged).
        assert!(peak_frames.len() >= 4, "only {} peaks", peak_frames.len());
    }

    #[test]
    fn pure_tone_yields_low_envelope() {
        let sr = 22050u32;
        let secs = 2.0;
        let n = (sr as f32 * secs) as usize;
        let mut y = vec![0.0f32; n];
        for i in 0..n {
            y[i] = 0.4 * (2.0 * PI * 440.0 * (i as f32) / sr as f32).sin();
        }
        let env = onset_envelope(&y, sr);
        // Past the initial onset, the envelope should be near zero.
        let tail_start = env.len() / 2;
        let tail_max = env[tail_start..].iter().cloned().fold(0.0_f32, f32::max);
        let head_max = env[..tail_start].iter().cloned().fold(0.0_f32, f32::max);
        assert!(tail_max < head_max * 0.2, "tail_max={} head_max={}", tail_max, head_max);
    }
}
