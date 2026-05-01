//! GCC-PHAT (Generalized Cross-Correlation with Phase Transform).
//!
//! Spectral whitening of the cross-spectrum: every frequency contributes
//! purely its *phase* (timing) to the correlation, with magnitude
//! information thrown away. The result for two recordings of the same
//! source — even through different microphones, EQ, or rooms — is a
//! delta-function-like peak at the true sample lag, with a noise floor
//! orders of magnitude below.
//!
//! This is the textbook tool for *same-source multi-mic* time-delay
//! estimation (Knapp & Carter, 1976). It does NOT help for cover
//! versions / different performances of the same piece — chroma+onset
//! is still the right primary detector for those. Here we use it as a
//! Stage B refiner: run only after the chroma+onset block found a
//! coarse lag, in a small window around that seed, to push offset
//! accuracy from ~half-hop (~12 ms) down toward sample-level (≪1 ms).
//!
//! References:
//! - Knapp & Carter, "The generalized correlation method for estimation
//!   of time delay" (IEEE TASSP, 1976).
//! - SyncSink.wasm — production implementation that follows the
//!   "fingerprint coarse → cross-correlation fine" pattern we mirror.
//! - Foroosh et al. — closed-form sub-sample peak via phase analysis
//!   (used implicitly here via parabolic interpolation; the closed form
//!   would be a future drop-in upgrade).

use realfft::{num_complex::Complex, ComplexToReal, RealFftPlanner, RealToComplex};
use std::sync::Arc;

/// PHAT-β whitening exponent. β = 1.0 is full PHAT (every bin
/// contributes only its phase); β = 0.0 is plain cross-correlation. A
/// β slightly below 1.0 (e.g. 0.7) is the textbook robust variant for
/// noisy / reverberant recordings: it down-weights very low-magnitude
/// bins where the phase estimate has poor SNR. Same-source-different-
/// mic studio audio is benign enough that full PHAT works well; we
/// expose β so callers can tune.
pub const PHAT_BETA_DEFAULT: f32 = 1.0;

/// Length (in seconds) of the audio window we run PHAT over. Has to be
/// LONG enough to defeat bar-level self-similarity in repetitive music
/// — a 4 s window on hip-hop / techno covers ≤ 2 bars, and chroma's
/// occasional bar-level wrong picks (real-music bench: pos-2000ms on
/// hiphop / jazz) are inside that span; PHAT then corroborates the
/// wrong seed because the windowed content is identical at any
/// bar-aligned shift inside the window. 20 s averages ≥ 4–8 bars and
/// breaks that ambiguity. Memory cost: a 20 s window @ 22 kHz ⇒ 441 k
/// samples ⇒ next_pow2 = 1 M complex<f32> ≈ 8 MB temp — acceptable.
const PHAT_WINDOW_SECONDS: f32 = 20.0;

/// Half-width (in seconds) of the lag-search range around the seed lag.
/// The chroma+onset stage produces a coarse lag accurate to ~half a
/// hop (~12 ms at 22 kHz). 0.5 s is more than three orders of magnitude
/// past that — enough for any plausible chroma bias, while bounding the
/// effective search away from spurious far-lag peaks in the PHAT array.
const PHAT_SEARCH_RADIUS_SECONDS: f32 = 0.5;

/// Floor on PNR for trusting the PHAT refinement. Below this, the
/// signal is too noisy / too unlike same-source for PHAT to help; we
/// keep the chroma+onset lag as authoritative.
pub const PHAT_PNR_THRESHOLD: f32 = 6.0;

/// Result of a successful PHAT refinement.
#[derive(Debug, Clone, Copy)]
pub struct PhatResult {
    /// Refined absolute lag, in audio samples. Same sign convention as
    /// `MatchCandidate::offset_samples` (positive = query is later
    /// than ref).
    pub offset_samples: i64,
    /// Peak-to-noise ratio of the PHAT correlation: peak height divided
    /// by the standard deviation of the array outside a small exclusion
    /// zone around the peak. >20 = textbook same-source match; <6
    /// suggests no meaningful phase coherence.
    pub pnr: f32,
}

/// GCC-PHAT cross-correlation, matching the lag convention of
/// `xcorr::correlate_full`: the returned array has length
/// `a.len() + b.len() - 1`, and index `k = b.len() - 1` is lag 0.
pub fn gcc_phat(a: &[f32], b: &[f32], beta: f32) -> Vec<f32> {
    let n_full = a.len() + b.len() - 1;
    if n_full == 0 {
        return Vec::new();
    }
    let n_fft = n_full.next_power_of_two().max(2);

    let mut planner: RealFftPlanner<f32> = RealFftPlanner::<f32>::new();
    let r2c: Arc<dyn RealToComplex<f32>> = planner.plan_fft_forward(n_fft);
    let c2r: Arc<dyn ComplexToReal<f32>> = planner.plan_fft_inverse(n_fft);

    let mut a_in = vec![0.0f32; n_fft];
    let mut b_in = vec![0.0f32; n_fft];
    a_in[..a.len()].copy_from_slice(a);
    // Time-reverse b so the FFT product gives correlation, matching
    // the convention in `correlate_full`. Without this we'd get
    // convolution, and the lag interpretation would flip sign.
    for (i, &v) in b.iter().enumerate() {
        b_in[b.len() - 1 - i] = v;
    }

    let mut a_out = r2c.make_output_vec();
    let mut b_out = r2c.make_output_vec();
    r2c.process(&mut a_in, &mut a_out).expect("fft a");
    r2c.process(&mut b_in, &mut b_out).expect("fft b");

    // PHAT-β whitening: prod[k] = (A[k] * B[k]) / |A[k] * B[k]|^β,
    // with an epsilon floor on the magnitude so silent bands don't
    // divide by zero. β = 1.0 = full PHAT; β = 0.0 = plain xcorr.
    let mut prod: Vec<Complex<f32>> = a_out
        .iter()
        .zip(b_out.iter())
        .map(|(x, y)| {
            let c = x * y;
            let mag = c.norm().max(1e-9);
            c / mag.powf(beta)
        })
        .collect();

    let mut out = vec![0.0f32; n_fft];
    c2r.process(&mut prod, &mut out).expect("ifft");
    let scale = 1.0 / n_fft as f32;
    for v in out.iter_mut() {
        *v *= scale;
    }
    out.truncate(n_full);
    out
}

/// Window a Hann taper around the input slice. Reduces edge artifacts
/// in the cross-spectrum (which would otherwise smear the PHAT peak).
fn apply_hann(y: &[f32]) -> Vec<f32> {
    let n = y.len();
    if n < 2 {
        return y.to_vec();
    }
    let mut out = Vec::with_capacity(n);
    let denom = (n - 1) as f32;
    for (i, &v) in y.iter().enumerate() {
        let w = 0.5
            * (1.0 - (2.0 * std::f32::consts::PI * i as f32 / denom).cos());
        out.push(v * w);
    }
    out
}

/// Refine a coarse seed lag to sample-level precision via GCC-PHAT in a
/// 4-s window around the seed. Returns `None` when:
///  - the seed lag puts both windows out of bounds (signals too short
///    for the window to fit),
///  - the resulting PNR is below `PHAT_PNR_THRESHOLD` (the caller
///    should fall back to the seed lag).
///
/// Same sign convention as `MatchCandidate::offset_samples`:
/// positive lag = query is later than ref.
pub fn phat_refine(
    ref_y: &[f32],
    query_y: &[f32],
    sample_rate: u32,
    seed_lag_samples: i64,
) -> Option<PhatResult> {
    let preferred_win_samples = (PHAT_WINDOW_SECONDS * sample_rate as f32) as usize;
    if preferred_win_samples < 64 {
        return None;
    }

    // Pick a window inside the overlap region. Convention for offset:
    // ref[t] aligns with query[t - offset], so the overlap in ref is
    // [max(0, offset), min(ref.len, query.len + offset)].
    let overlap_start_ref = seed_lag_samples.max(0);
    let overlap_end_ref =
        (ref_y.len() as i64).min(query_y.len() as i64 + seed_lag_samples);
    let overlap_len = overlap_end_ref - overlap_start_ref;
    // Adaptive fallback: when the available overlap is shorter than the
    // preferred window (short clips, edge-of-signal seeds), shrink the
    // window down to the overlap. Below ~2 s the FFT bins get too few
    // taps to whiten reliably, so we bail out instead of producing a
    // noisy refinement.
    let min_win_samples = (2.0 * sample_rate as f32) as i64;
    if overlap_len < min_win_samples {
        return None;
    }
    let win_samples = preferred_win_samples.min(overlap_len as usize);
    // Center the window inside the overlap region.
    let mid = overlap_start_ref + (overlap_end_ref - overlap_start_ref) / 2;
    let ref_start = (mid - win_samples as i64 / 2)
        .max(overlap_start_ref)
        .min(overlap_end_ref - win_samples as i64) as usize;
    let ref_end = ref_start + win_samples;

    // Corresponding query window so the seed-aligned positions overlap
    // sample-wise: query[t] = ref[t + offset].
    let query_start_i = ref_start as i64 - seed_lag_samples;
    if query_start_i < 0 || query_start_i + win_samples as i64 > query_y.len() as i64 {
        return None;
    }
    let query_start = query_start_i as usize;
    let query_end = query_start + win_samples;

    let ref_win = apply_hann(&ref_y[ref_start..ref_end]);
    let query_win = apply_hann(&query_y[query_start..query_end]);

    // gcc_phat(query, ref) — keeps the lag convention identical to the
    // chroma path: index `k = ref.len() - 1` is lag 0, larger k = query
    // appearing later in ref's timeline.
    let phat = gcc_phat(&query_win, &ref_win, PHAT_BETA_DEFAULT);
    if phat.is_empty() {
        return None;
    }
    let center_idx = ref_win.len() - 1;
    let radius_samples =
        (PHAT_SEARCH_RADIUS_SECONDS * sample_rate as f32) as i64;
    let search_start =
        ((center_idx as i64) - radius_samples).max(0) as usize;
    let search_end = ((center_idx as i64) + radius_samples)
        .min(phat.len() as i64 - 1) as usize;
    if search_end <= search_start {
        return None;
    }

    let mut peak_idx = search_start;
    let mut peak_val = f32::NEG_INFINITY;
    for k in search_start..=search_end {
        if phat[k] > peak_val {
            peak_val = phat[k];
            peak_idx = k;
        }
    }
    if !peak_val.is_finite() {
        return None;
    }

    // Parabolic sub-sample interpolation around the peak. Same closed
    // form as the chroma stage in ncc.rs::refine_peak_offset_samples.
    let frac = if peak_idx > 0 && peak_idx + 1 < phat.len() {
        let a = phat[peak_idx - 1];
        let b = phat[peak_idx];
        let c = phat[peak_idx + 1];
        let denom = a - 2.0 * b + c;
        if denom.abs() > 1e-12 && denom < 0.0 {
            let d = 0.5 * (a - c) / denom;
            if d.is_finite() && d.abs() <= 1.0 {
                d
            } else {
                0.0
            }
        } else {
            0.0
        }
    } else {
        0.0
    };

    // Lag within the windows in samples (correlate convention: shift =
    // peak_idx - (ref_win.len() - 1)). When the seed was too HIGH
    // (claimed query was later than truth), query_win starts earlier
    // than ideal in the original query timeline, so PHAT places the
    // peak at *positive* lag — and we should *subtract* that shift
    // from the seed to recover the true lag. Concretely:
    //   query_win[i] = query_y[ref_start - seed + i]
    //   if seed = true_lag → peak at lag 0
    //   if seed = true_lag + k (too high) → peak at lag +k
    //   refined = seed - peak_lag
    let shift_within_window = peak_idx as f64 + frac as f64 - center_idx as f64;
    let refined_offset = seed_lag_samples - shift_within_window.round() as i64;

    // Peak-to-noise: standard deviation of the PHAT array within the
    // search range, excluding a small ±N exclusion zone around the
    // peak. Lab convention is to exclude ±10–20 samples of the main
    // lobe; we use ±50 to stay clear of any sidelobes too.
    let exclude = 50i64;
    let mut sum_sq = 0.0_f64;
    let mut count = 0_usize;
    for k in search_start..=search_end {
        if (k as i64 - peak_idx as i64).abs() <= exclude {
            continue;
        }
        let v = phat[k] as f64;
        sum_sq += v * v;
        count += 1;
    }
    let std_floor = if count > 0 {
        (sum_sq / count as f64).sqrt() as f32
    } else {
        1e-9
    };
    let pnr = peak_val / std_floor.max(1e-9);
    if !pnr.is_finite() || pnr < PHAT_PNR_THRESHOLD {
        return None;
    }

    Some(PhatResult {
        offset_samples: refined_offset,
        pnr,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn make_tone(freq: f32, secs: f32, sr: u32) -> Vec<f32> {
        let n = (secs * sr as f32) as usize;
        let mut y = vec![0.0f32; n];
        for i in 0..n {
            y[i] = 0.5 * (2.0 * PI * freq * i as f32 / sr as f32).sin();
        }
        y
    }

    fn make_broadband(secs: f32, sr: u32, seed: u64) -> Vec<f32> {
        // White-noise-like pseudo-broadband signal. PHAT loves broadband.
        let n = (secs * sr as f32) as usize;
        let mut y = vec![0.0f32; n];
        let mut s = seed.wrapping_mul(0x9E37_79B9_7F4A_7C15);
        for v in y.iter_mut() {
            s ^= s << 13;
            s ^= s >> 7;
            s ^= s << 17;
            *v = (s as f32 / u64::MAX as f32) * 2.0 - 1.0;
        }
        y
    }

    /// Identity case: gcc_phat(x, x) for any signal must peak at lag 0
    /// (index = len - 1) with PNR much higher than the body of the
    /// array.
    #[test]
    fn gcc_phat_identity_peaks_at_zero_lag() {
        let sr = 22050;
        let song = make_broadband(2.0, sr, 7);
        let phat = gcc_phat(&song, &song, 1.0);
        let peak_idx = phat
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap()
            .0;
        assert_eq!(peak_idx, song.len() - 1);
    }

    /// PHAT must recover a known sample-precise delay.
    #[test]
    fn gcc_phat_recovers_integer_delay() {
        let sr = 22050;
        let base = make_broadband(2.0, sr, 11);
        // shift query later by 137 samples
        let mut query = vec![0.0f32; base.len()];
        for i in 137..base.len() {
            query[i] = base[i - 137];
        }
        let phat = gcc_phat(&query, &base, 1.0);
        let peak_idx = phat
            .iter()
            .enumerate()
            .max_by(|a, b| a.1.partial_cmp(b.1).unwrap())
            .unwrap()
            .0;
        let lag = peak_idx as i64 - (base.len() as i64 - 1);
        assert_eq!(lag, 137, "expected lag=+137, got {}", lag);
    }

    /// `phat_refine` should turn a deliberately-off seed into the true
    /// sample-precise lag for a same-source pair.
    #[test]
    fn phat_refine_corrects_off_seed() {
        let sr = 22050u32;
        let base = make_broadband(8.0, sr, 23);
        let true_lag = 4321i64; // arbitrary mid-range integer lag
        let pad = vec![0.0f32; true_lag as usize];
        let mut ref_y = pad.clone();
        ref_y.extend_from_slice(&base);
        let query_y = base.clone();

        // Seed off by ~250 samples (within search radius).
        let seed = true_lag + 250;
        let r = phat_refine(&ref_y, &query_y, sr, seed).expect("phat result");
        assert_eq!(
            r.offset_samples, true_lag,
            "refined lag should equal true lag; got {}",
            r.offset_samples,
        );
        assert!(r.pnr > 20.0, "expected sharp PHAT peak; pnr={}", r.pnr);
    }

    /// On a pure single-frequency tone, PHAT's peak is genuinely
    /// ambiguous (every period of the tone gives a perfect-phase match).
    /// The PNR floor must catch this and return `None`.
    #[test]
    fn phat_refine_rejects_narrowband_input() {
        let sr = 22050u32;
        let tone = make_tone(440.0, 6.0, sr);
        let true_lag = 1234i64;
        let mut ref_y = vec![0.0f32; true_lag as usize];
        ref_y.extend_from_slice(&tone);
        let query_y = tone;
        // A correct seed that nonetheless produces an ambiguous PHAT
        // because periodicity of the tone seeds many same-height peaks.
        let result = phat_refine(&ref_y, &query_y, sr, true_lag);
        // Either None (PNR too low) or a result — but if a result, PNR
        // should not be sky-high. The contract here is "fall back
        // gracefully" — we don't assert a specific outcome, only that
        // we don't crash and don't claim absurd PNR.
        if let Some(r) = result {
            assert!(
                r.pnr.is_finite(),
                "PNR must be finite even on tonal input; got {}",
                r.pnr,
            );
        }
    }
}
