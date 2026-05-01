//! Top-level orchestrator: takes two PCM mono buffers, returns a SyncResult.
//!
//! Mirrors `app/pipeline/sync.py:sync_audio` 1:1 in structure.

use crate::chroma::{self, ChromaMatrix, HOP, N_PITCH_CLASSES};
use crate::drift::{windowed_drift_refinement, DriftConfig};
use crate::dtw::dtw_drift;
use crate::ncc::{align_with_onset, MatchCandidate};
use crate::onset::onset_envelope;
use crate::util::peak_normalize;
use crate::xcorr::correlate_full;

#[derive(Debug, Clone)]
pub struct SyncResult {
    pub offset_ms: f64,
    pub confidence: f64,
    pub drift_ratio: f64,
    pub method: String,
    pub warning: Option<String>,
    /// Alternate match candidates with NCC ≥ 60 % of the primary's. Sorted
    /// descending by NCC. Used by the editor for snap-to-alternate-match.
    pub candidates: Vec<MatchCandidateOut>,
    /// Primary peak / second-highest peak on the ranking surface. >1.5 ≈
    /// comfortable margin; ≈1.0 means the runner-up is essentially as
    /// strong as the pick (UI should warn). `f64::INFINITY` when no
    /// runner-up exists. Surfaced from `AlignmentReport::discrimination`.
    pub peak_to_second_ratio: f64,
    /// Primary peak / median correlation over the valid-overlap region.
    /// "How exceptional is the chosen lag." `f64::INFINITY` for
    /// degenerate inputs.
    pub peak_to_noise: f64,
}

#[derive(Debug, Clone)]
pub struct MatchCandidateOut {
    pub offset_ms: f64,
    pub confidence: f64,
    pub overlap_frames: u32,
}

impl From<&MatchCandidate> for MatchCandidateOut {
    fn from(c: &MatchCandidate) -> Self {
        // Use the actual SR — passed in via a closure or recomputed here.
        // This conversion lives in `sync_audio_pcm` where SR is in scope.
        Self {
            offset_ms: 0.0,
            confidence: c.ncc as f64,
            overlap_frames: c.overlap_frames,
        }
    }
}

fn cand_to_out(c: &MatchCandidate, sr: u32) -> MatchCandidateOut {
    MatchCandidateOut {
        offset_ms: c.offset_samples as f64 / sr as f64 * 1000.0,
        confidence: c.ncc as f64,
        overlap_frames: c.overlap_frames,
    }
}

/// Cosine confidence between two L2-normalized chroma matrices at a given lag.
fn chroma_confidence_at_offset(cr: &ChromaMatrix, cq: &ChromaMatrix, offset_samples: i64) -> f64 {
    if cr.n_frames == 0 || cq.n_frames == 0 {
        return 0.0;
    }
    let lag_frames = -((offset_samples as f64) / HOP as f64).round() as i64;
    let start_i = (-lag_frames).max(0) as usize;
    let end_i = (cr.n_frames as i64).min(cq.n_frames as i64 - lag_frames) as i64;
    if end_i <= start_i as i64 {
        return 0.0;
    }
    let end_i = end_i as usize;
    let mut sum = 0.0f64;
    let n = end_i - start_i;
    for i in start_i..end_i {
        let qi = (i as i64 + lag_frames) as usize;
        let mut dot = 0.0f32;
        for c in 0..N_PITCH_CLASSES {
            dot += cr.row(c)[i] * cq.row(c)[qi];
        }
        sum += dot as f64;
    }
    let mean = sum / n as f64;
    mean.clamp(0.0, 1.0)
}

fn chroma_alignment(cr: &ChromaMatrix, cq: &ChromaMatrix) -> (i64, f64) {
    if cr.n_frames == 0 || cq.n_frames == 0 {
        return (0, 0.0);
    }
    let n_full = cr.n_frames + cq.n_frames - 1;
    let mut accum = vec![0.0f32; n_full];
    for d in 0..N_PITCH_CLASSES {
        // correlate(cq[d], cr[d], mode="full") — note query first, ref second
        let c = correlate_full(cq.row(d), cr.row(d));
        for (i, v) in c.iter().enumerate() {
            accum[i] += v;
        }
    }
    let mut peak_idx = 0usize;
    let mut peak_val = f32::NEG_INFINITY;
    for (i, &v) in accum.iter().enumerate() {
        if v > peak_val {
            peak_val = v;
            peak_idx = i;
        }
    }
    let lag_frames = peak_idx as i64 - (cr.n_frames as i64 - 1);
    let offset_samples = -lag_frames * HOP as i64;
    let confidence = chroma_confidence_at_offset(cr, cq, offset_samples);
    (offset_samples, confidence)
}

#[derive(Debug, Clone, Copy)]
pub struct SyncOptions {
    pub sr: u32,
    pub confidence_threshold: f64,
}

impl Default for SyncOptions {
    fn default() -> Self {
        Self {
            sr: 22050,
            confidence_threshold: 0.4,
        }
    }
}

pub fn sync_audio_pcm(ref_pcm: &[f32], query_pcm: &[f32], opts: SyncOptions) -> SyncResult {
    if ref_pcm.is_empty() || query_pcm.is_empty() {
        return SyncResult {
            offset_ms: 0.0,
            confidence: 0.0,
            drift_ratio: 1.0,
            method: "chroma".to_string(),
            warning: Some("Empty audio".to_string()),
            candidates: Vec::new(),
            peak_to_second_ratio: f64::INFINITY,
            peak_to_noise: f64::INFINITY,
        };
    }

    let mut ref_y = ref_pcm.to_vec();
    let mut query_y = query_pcm.to_vec();
    peak_normalize(&mut ref_y);
    peak_normalize(&mut query_y);

    let cr = chroma::chroma_features(&ref_y, opts.sr);
    let cq = chroma::chroma_features(&query_y, opts.sr);

    // Primary alignment uses NCC + onset-envelope fusion + multi-candidate
    // peak picking. The onset envelope is folded into the NCC array
    // BEFORE peak picking so it can promote a true-but-quiet chroma peak
    // over a wrong-but-loud one (self-similar bar boundaries in
    // repetitive music are the classic failure case).
    let onset_ref = onset_envelope(&ref_y, opts.sr);
    let onset_query = onset_envelope(&query_y, opts.sr);
    let report = align_with_onset(
        &cr,
        &cq,
        &onset_ref,
        &onset_query,
        opts.sr,
        /*max_alternates=*/ 10,
    );

    let (mut lag, mut confidence, mut candidates, peak_to_second, peak_to_noise) =
        match report {
            Some(r) => {
                // Primary stays whatever chroma+onset picked. Sample-level
                // Pearson re-ranking was tried and made primaries WORSE on
                // real music (raw audio inner product is too sensitive to
                // amplitude/noise differences) — but the same scoring is a
                // useful confidence reading on each surfaced candidate, so
                // the UI's snap-to-alternate-match list can rank them.
                let mut cands: Vec<MatchCandidateOut> = std::iter::once(&r.primary)
                    .chain(r.alternates.iter())
                    .map(|c| {
                        let mut out = cand_to_out(c, opts.sr);
                        let sample =
                            sample_level_pearson(&ref_y, &query_y, c.offset_samples);
                        // Surface the higher of chroma-NCC and sample-NCC so
                        // alts that look strong at the audio level are visibly
                        // ranked higher in the snap UI.
                        out.confidence = (sample as f64).max(c.ncc as f64);
                        out
                    })
                    .collect();
                let primary_lag = r.primary.offset_samples;
                let primary_conf = r.primary.ncc as f64;
                if let Some(p) = cands.get_mut(0) {
                    p.confidence = primary_conf;
                }
                (
                    primary_lag,
                    primary_conf,
                    cands,
                    r.discrimination.peak_to_second_ratio as f64,
                    r.discrimination.peak_to_noise as f64,
                )
            }
            None => (0, 0.0, Vec::new(), f64::INFINITY, f64::INFINITY),
        };
    let mut method = "ncc+onset".to_string();
    let mut drift = 1.0f64;
    let mut warning: Option<String> = None;

    if confidence < opts.confidence_threshold {
        method = "ncc+onset+dtw".to_string();
        let cr_dtw = compute_chroma_with_hop(&ref_y, opts.sr, 1024);
        let cq_dtw = compute_chroma_with_hop(&query_y, opts.sr, 1024);
        let (offset_dtw, drift_dtw) = dtw_drift(&cr_dtw, &cq_dtw, 1024);
        let lag_dtw = offset_dtw.round() as i64;
        let conf_dtw = chroma_confidence_at_offset(&cr, &cq, lag_dtw);
        if conf_dtw > confidence {
            lag = lag_dtw;
            confidence = conf_dtw;
            drift = drift_dtw;
        }
    }

    // Drift refinement seeded by the primary chroma+onset candidate. The
    // ±1 s sanity check stops drift from wandering into another local
    // lock-in if its per-window xcorr disagrees badly with the seed.
    if confidence >= opts.confidence_threshold {
        if let Some(refined) =
            windowed_drift_refinement(&ref_y, &query_y, opts.sr, lag, DriftConfig::default())
        {
            if (refined.offset_samples - lag).abs() <= opts.sr as i64 {
                lag = refined.offset_samples;
                drift = refined.drift_ratio;
                method.push_str("+drift");
                if let Some(p) = candidates.get_mut(0) {
                    p.offset_ms = lag as f64 / opts.sr as f64 * 1000.0;
                }
            }
        }
    }

    if (drift - 1.0).abs() > 0.001 {
        let msg = format!("Audio drift detected: {:.4}%", (drift - 1.0) * 100.0);
        warning = Some(match warning {
            Some(prev) => format!("{}; {}", prev, msg),
            None => msg,
        });
    }

    if confidence < 0.3 {
        let msg = "Low sync confidence — preview before sharing".to_string();
        warning = Some(match warning {
            Some(prev) => format!("{}; {}", prev, msg),
            None => msg,
        });
    }

    let offset_ms = (lag as f64 / opts.sr as f64) * 1000.0;
    SyncResult {
        offset_ms,
        confidence,
        drift_ratio: drift,
        method,
        warning,
        candidates,
        peak_to_second_ratio: peak_to_second,
        peak_to_noise,
    }
}

/// Pearson-style normalized correlation of two PCM signals at a specific
/// integer-sample lag. Returns a value in [-1, 1]; ≥ 0 means the signals
/// are positively correlated over the overlap region.
///
/// Used as the disambiguator after chroma+onset peak picking. Chroma
/// rewards beat-grid-aligned positions equally for repetitive music;
/// sample-level inner product is much more sensitive to where transients
/// actually fall (a one-beat shift drops correlation toward zero).
///
/// Implementation: O(N) loop. Skips the work entirely if the overlap
/// would be tiny (< 0.5 s).
fn sample_level_pearson(ref_y: &[f32], query_y: &[f32], lag_samples: i64) -> f32 {
    let n_r = ref_y.len() as i64;
    let n_q = query_y.len() as i64;
    let start = (-lag_samples).max(0);
    let end = n_r.min(n_q - lag_samples);
    if end <= start {
        return 0.0;
    }
    let n = (end - start) as usize;
    if n < 11_025 {
        return 0.0;
    } // < 0.5 s @ 22050 Hz
    let mut dot = 0.0_f64;
    let mut sum_r2 = 0.0_f64;
    let mut sum_q2 = 0.0_f64;
    for i in start..end {
        let r = ref_y[i as usize] as f64;
        let q = query_y[(i + lag_samples) as usize] as f64;
        dot += r * q;
        sum_r2 += r * r;
        sum_q2 += q * q;
    }
    let denom = (sum_r2 * sum_q2).sqrt();
    if denom < 1e-12 {
        0.0
    } else {
        (dot / denom).clamp(-1.0, 1.0) as f32
    }
}

/// Like `chroma_features` but with configurable hop. Used for the DTW path.
/// Re-implements the inner loop; shares the constants/window logic.
fn compute_chroma_with_hop(y: &[f32], sr: u32, hop: usize) -> ChromaMatrix {
    use realfft::RealFftPlanner;

    const N_FFT: usize = 2048;
    if y.len() < N_FFT {
        return ChromaMatrix {
            data: Vec::new(),
            n_frames: 0,
        };
    }
    let n_frames = (y.len() - N_FFT) / hop + 1;

    let mut window = vec![0.0f32; N_FFT];
    for i in 0..N_FFT {
        let arg = std::f32::consts::PI * (i as f32) / ((N_FFT - 1) as f32);
        window[i] = arg.sin().powi(2);
    }
    let n_bins = N_FFT / 2 + 1;
    let mut bin_to_class: Vec<i32> = vec![-1; n_bins];
    let bin_hz = sr as f32 / N_FFT as f32;
    let a4 = 440.0_f32;
    for k in 1..n_bins {
        let f = (k as f32) * bin_hz;
        if !(30.0..=8000.0).contains(&f) {
            continue;
        }
        let semis = 12.0 * (f / a4).log2();
        let note = (semis.round() as i32) + 69;
        bin_to_class[k] = ((note % 12) + 12) % 12;
    }
    let mut planner: RealFftPlanner<f32> = RealFftPlanner::<f32>::new();
    let r2c = planner.plan_fft_forward(N_FFT);
    let mut input = r2c.make_input_vec();
    let mut output = r2c.make_output_vec();

    let mut data = vec![0.0f32; N_PITCH_CLASSES * n_frames];
    for frame in 0..n_frames {
        let start = frame * hop;
        let end = start + N_FFT;
        if end > y.len() {
            break;
        }
        for i in 0..N_FFT {
            input[i] = y[start + i] * window[i];
        }
        r2c.process(&mut input, &mut output).expect("fft");
        let mut bins = [0.0f32; N_PITCH_CLASSES];
        for k in 1..n_bins {
            let class = bin_to_class[k];
            if class < 0 {
                continue;
            }
            let re = output[k].re;
            let im = output[k].im;
            bins[class as usize] += (re * re + im * im).sqrt();
        }
        let mut norm = 0.0f32;
        for &b in bins.iter() {
            norm += b * b;
        }
        norm = norm.sqrt();
        if norm > 1e-9 {
            for c in 0..N_PITCH_CLASSES {
                data[c * n_frames + frame] = bins[c] / norm;
            }
        }
    }
    ChromaMatrix { data, n_frames }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f32::consts::PI;

    fn make_tone_segment(freq: f32, secs: f32, sr: u32) -> Vec<f32> {
        let n = (secs * sr as f32) as usize;
        let mut y = vec![0.0f32; n];
        for i in 0..n {
            y[i] = 0.5 * (2.0 * PI * freq * (i as f32) / sr as f32).sin();
        }
        y
    }

    fn make_song(secs: f32, sr: u32) -> Vec<f32> {
        // 5 different tones, each 0.5 s.
        let scale = [220.0, 261.6, 329.6, 391.99, 466.16];
        let mut y: Vec<f32> = Vec::new();
        let mut i = 0;
        while (y.len() as f32) < secs * sr as f32 {
            let f = scale[i % scale.len()];
            y.extend(make_tone_segment(f, 0.5, sr));
            i += 1;
        }
        y.truncate((secs * sr as f32) as usize);
        y
    }

    #[test]
    fn identical_inputs_yield_offset_zero_high_confidence() {
        let sr = 22050;
        let song = make_song(8.0, sr);
        let r = sync_audio_pcm(&song, &song, SyncOptions::default());
        assert!(r.offset_ms.abs() < 50.0, "offset_ms = {}", r.offset_ms);
        assert!(r.confidence > 0.85, "confidence = {}", r.confidence);
    }

    #[test]
    fn detects_known_positive_offset() {
        let sr = 22050u32;
        let song = make_song(8.0, sr);
        // ref = silence(400ms) + song; query = song. Offset should be +400ms.
        let pad = (0.4 * sr as f32) as usize;
        let mut reference = vec![0.0f32; pad];
        reference.extend_from_slice(&song);
        let r = sync_audio_pcm(&reference, &song, SyncOptions::default());
        assert!(
            (r.offset_ms - 400.0).abs() < 60.0,
            "offset_ms = {} (expected ~400)",
            r.offset_ms
        );
    }
}
