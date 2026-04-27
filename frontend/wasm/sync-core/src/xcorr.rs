//! FFT-based cross-correlation.
//!
//! `correlate(a, b, mode="full")` ≡ a[n] ⋆ b[-n], i.e. `c[k] = sum_n a[n+k]*b[n]`.
//! Length: `len(a) + len(b) - 1`. Index `k = 0` corresponds to the most-negative
//! lag (`-(len(b)-1)`); `k = len(b)-1` corresponds to lag = 0; `k = len(a)+len(b)-2`
//! corresponds to the most-positive lag (`len(a)-1`).

use realfft::{ComplexToReal, RealFftPlanner, RealToComplex, num_complex::Complex};
use std::sync::Arc;

/// Returns the full cross-correlation of `a` with `b` (numpy/scipy convention).
/// Length: `a.len() + b.len() - 1`.
pub fn correlate_full(a: &[f32], b: &[f32]) -> Vec<f32> {
    let n_full = a.len() + b.len() - 1;
    if n_full == 0 {
        return Vec::new();
    }
    // Pad to next power of two for FFT (faster).
    let n_fft = n_full.next_power_of_two().max(2);

    let mut planner: RealFftPlanner<f32> = RealFftPlanner::<f32>::new();
    let r2c: Arc<dyn RealToComplex<f32>> = planner.plan_fft_forward(n_fft);
    let c2r: Arc<dyn ComplexToReal<f32>> = planner.plan_fft_inverse(n_fft);

    let mut a_in = vec![0.0f32; n_fft];
    let mut b_in = vec![0.0f32; n_fft];
    a_in[..a.len()].copy_from_slice(a);
    // Time-reversed b for correlation = convolution(a, reversed(b))
    for (i, &v) in b.iter().enumerate() {
        b_in[b.len() - 1 - i] = v;
    }

    let mut a_out = r2c.make_output_vec();
    let mut b_out = r2c.make_output_vec();
    r2c.process(&mut a_in, &mut a_out).expect("fft a");
    r2c.process(&mut b_in, &mut b_out).expect("fft b");

    let mut prod: Vec<Complex<f32>> = a_out
        .iter()
        .zip(b_out.iter())
        .map(|(x, y)| x * y)
        .collect();

    let mut out = vec![0.0f32; n_fft];
    c2r.process(&mut prod, &mut out).expect("ifft");
    // realfft doesn't normalize; divide by n_fft.
    let scale = 1.0 / (n_fft as f32);
    for v in out.iter_mut() {
        *v *= scale;
    }
    out.truncate(n_full);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn naive_correlate_full(a: &[f32], b: &[f32]) -> Vec<f32> {
        let n_full = a.len() + b.len() - 1;
        let mut out = vec![0.0f32; n_full];
        // c[k] = sum_n a[n] * b[n - (k - (len(b) - 1))]
        //      = sum_n a[n] * b[n - lag]  where lag = k - (len(b)-1)
        for k in 0..n_full {
            let lag = k as i64 - (b.len() as i64 - 1);
            let mut s = 0.0f32;
            for n in 0..a.len() {
                let bi = n as i64 - lag;
                if (0..b.len() as i64).contains(&bi) {
                    s += a[n] * b[bi as usize];
                }
            }
            out[k] = s;
        }
        out
    }

    #[test]
    fn fft_matches_naive_on_small_inputs() {
        let a = [1.0, 2.0, 3.0, 4.0];
        let b = [0.5, 1.0, -0.5];
        let fft = correlate_full(&a, &b);
        let naive = naive_correlate_full(&a, &b);
        assert_eq!(fft.len(), naive.len());
        for (i, (x, y)) in fft.iter().zip(naive.iter()).enumerate() {
            assert!(
                (x - y).abs() < 1e-3,
                "index {}: fft={} naive={}",
                i,
                x,
                y
            );
        }
    }

    /// Auto-correlation of a signal with itself peaks at lag 0
    /// (which is index `b.len() - 1` in the full output).
    #[test]
    fn autocorr_peaks_at_zero_lag() {
        let a: Vec<f32> = (0..32).map(|i| ((i as f32) * 0.3).sin()).collect();
        let c = correlate_full(&a, &a);
        let zero_lag_idx = a.len() - 1;
        let peak_idx = c
            .iter()
            .enumerate()
            .max_by(|x, y| x.1.partial_cmp(y.1).unwrap())
            .unwrap()
            .0;
        assert_eq!(peak_idx, zero_lag_idx);
    }

    /// Shifting `a` to produce `b` should make the peak appear at the matching lag.
    #[test]
    fn shifted_signal_has_peak_at_known_lag() {
        let n = 64;
        let mut a = vec![0.0f32; n];
        for i in 0..n {
            a[i] = ((i as f32) * 0.4).sin();
        }
        // b is a shifted by +5 samples (b[i+5] = a[i]) → b leads a by 5.
        let mut b = vec![0.0f32; n];
        for i in 0..n - 5 {
            b[i + 5] = a[i];
        }
        let c = correlate_full(&a, &b);
        // Find peak.
        let peak_idx = c
            .iter()
            .enumerate()
            .max_by(|x, y| x.1.partial_cmp(y.1).unwrap())
            .unwrap()
            .0;
        // Lag for peak = peak_idx - (b.len() - 1)
        let lag = peak_idx as i64 - (b.len() as i64 - 1);
        // a is "earlier" by 5 samples → correlate(a, b) peaks at lag = -5
        assert_eq!(lag, -5, "got lag = {}", lag);
    }
}
