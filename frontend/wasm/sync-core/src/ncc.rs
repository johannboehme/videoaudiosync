//! Normalized cross-correlation for chroma matrices + multi-candidate
//! peak picking.
//!
//! Why this exists: the original `chroma_alignment` uses an unnormalized
//! sum across all lags. That gives the lag with the biggest raw dot
//! product, which is biased toward lags with more overlap (and toward
//! self-similar regions in repetitive music). Concretely: for `ref =
//! silence(2s) + master, query = master`, the algorithm reported +1440 ms
//! instead of +2000 ms — locked onto a self-similar bar boundary inside
//! the master.
//!
//! The fix here:
//!   1. Compute the cross-correlation as a sum over chroma channels (FFT-
//!      based, same as before — fast).
//!   2. Compute a per-lag normalizer = sqrt(N_overlap_ref * N_overlap_query)
//!      where each "N" is the count of NON-SILENT frames overlapping at
//!      that lag. Each chroma frame is L2-normalized to 1 (non-silent) or
//!      0 (silent), so this is a literal frame count.
//!   3. NCC = correlation / normalizer, in the overlap region only.
//!   4. Reject lags with overlap below a fraction of the smaller signal
//!      (avoids the trivial "edge match" pathology where 2 frames happen
//!      to align perfectly).
//!   5. Pick the global peak as the primary candidate, then find local
//!      maxima with min-distance separation as alternates.

use crate::chroma::{ChromaMatrix, HOP, N_PITCH_CLASSES};
use crate::xcorr::correlate_full;

/// Minimum joint-active fraction of the shorter signal we require at a
/// candidate lag. Below this we set NCC to 0 (i.e. ignore the lag).
const MIN_OVERLAP_FRACTION: f32 = 0.20;

/// Minimum spacing between alternate candidates, in seconds. Two peaks
/// closer than this collapse into one (the higher).
const MIN_PEAK_SPACING_S: f32 = 1.0;

/// Alternate candidates with NCC below `top_ncc * REL_THRESHOLD` are
/// dropped. 0.6 keeps anything above 60 % of the leader.
const REL_THRESHOLD: f32 = 0.6;

#[derive(Debug, Clone)]
pub struct MatchCandidate {
    /// Lag in samples (signed). Positive = query is later than ref.
    pub offset_samples: i64,
    /// Normalized cross-correlation at this lag. Range [0, 1].
    pub ncc: f32,
    /// Number of jointly active chroma frames at this lag. Confidence
    /// rises with more frames in the overlap.
    pub overlap_frames: u32,
}

#[derive(Debug, Clone)]
pub struct AlignmentReport {
    pub primary: MatchCandidate,
    /// Up to N alternate candidates with NCC ≥ REL_THRESHOLD * primary.ncc,
    /// sorted descending by NCC. Used for "snap to alternate match" UI.
    pub alternates: Vec<MatchCandidate>,
}

/// Compute the per-frame "active" mask: 1 if the frame has non-zero
/// L2 norm (any harmonic content), 0 if it's silent. Each chroma frame
/// is already L2-normalized so this is just "any nonzero coefficient".
fn active_mask(c: &ChromaMatrix) -> Vec<f32> {
    let mut mask = vec![0.0f32; c.n_frames];
    for t in 0..c.n_frames {
        for d in 0..N_PITCH_CLASSES {
            if c.row(d)[t].abs() > 0.0 {
                mask[t] = 1.0;
                break;
            }
        }
    }
    mask
}

/// Compute the unnormalized chroma cross-correlation as a flat vector
/// of length `cr.n_frames + cq.n_frames - 1`.
fn raw_chroma_correlation(cr: &ChromaMatrix, cq: &ChromaMatrix) -> Vec<f32> {
    let n_full = cr.n_frames + cq.n_frames - 1;
    let mut accum = vec![0.0f32; n_full];
    for d in 0..N_PITCH_CLASSES {
        let c = correlate_full(cq.row(d), cr.row(d));
        for (i, v) in c.iter().enumerate() {
            accum[i] += v;
        }
    }
    accum
}

/// Compute the per-lag overlap-active count for two binary-active masks.
/// Same shape as `correlate_full(cq_mask, cr_mask)`. We reuse the FFT
/// path so the cost stays linearithmic.
fn overlap_counts(cr_mask: &[f32], cq_mask: &[f32]) -> Vec<f32> {
    correlate_full(cq_mask, cr_mask)
}

/// Index `i` in `correlate_full(cq, cr)` corresponds to lag (in cq frames):
/// `lag = cr.n_frames - 1 - i`. Translates back via:
fn idx_to_offset_samples(idx: usize, n_ref_frames: usize, hop: usize) -> i64 {
    let lag_frames = idx as i64 - (n_ref_frames as i64 - 1);
    -lag_frames * hop as i64
}

/// Score a single candidate lag against a pair of 1-D feature sequences
/// (typically onset envelopes). Returns the Pearson-like normalized
/// correlation in [0, 1] over the overlapping region, OR 0 if the
/// overlap is too small.
///
/// Used to break ties between chroma candidates that look similar from
/// the harmonic side — onset envelopes are far more discriminative in
/// time, so they pick out the right peak when chroma alone can't tell
/// two bar boundaries apart.
pub fn score_lag_1d(
    a: &[f32],
    b: &[f32],
    offset_samples: i64,
    sample_rate: u32,
    feat_hop: usize,
    min_overlap_s: f32,
) -> f32 {
    // Onset envelope sample rate equals SR / hop. Convert audio offset
    // to envelope-frame lag.
    let lag_frames = -((offset_samples as f64) / feat_hop as f64).round() as i64;
    let n_a = a.len() as i64;
    let n_b = b.len() as i64;
    let start_a = (-lag_frames).max(0);
    let end_a = n_a.min(n_b - lag_frames);
    if end_a <= start_a {
        return 0.0;
    }
    let overlap_frames = (end_a - start_a) as usize;
    let min_frames = (min_overlap_s * sample_rate as f32 / feat_hop as f32) as usize;
    if overlap_frames < min_frames.max(8) {
        return 0.0;
    }
    let mut dot = 0.0_f64;
    let mut sa = 0.0_f64;
    let mut sb = 0.0_f64;
    for i in start_a..end_a {
        let qi = i + lag_frames;
        let av = a[i as usize] as f64;
        let bv = b[qi as usize] as f64;
        dot += av * bv;
        sa += av * av;
        sb += bv * bv;
    }
    let denom = (sa * sb).sqrt();
    if denom < 1e-9 {
        return 0.0;
    }
    (dot / denom).clamp(0.0, 1.0) as f32
}

/// NCC alignment: returns a primary candidate plus alternate lags whose
/// NCC is at least `REL_THRESHOLD` of the primary's. Limits the
/// alternates list to `max_alternates`. When `onset_*` are provided
/// they're folded into the NCC pre-peak-picking — onset envelopes carry
/// orthogonal info (transient timing) that disambiguates self-similar
/// chroma regions.
pub fn align_with_candidates(
    cr: &ChromaMatrix,
    cq: &ChromaMatrix,
    sample_rate: u32,
    max_alternates: usize,
) -> Option<AlignmentReport> {
    align_with_onset(cr, cq, &[], &[], sample_rate, max_alternates)
}

/// Same as `align_with_candidates`, plus an onset-envelope NCC pass that
/// is summed into the chroma NCC before peak picking. Pass empty slices
/// for the onset args to skip onset fusion.
pub fn align_with_onset(
    cr: &ChromaMatrix,
    cq: &ChromaMatrix,
    onset_r: &[f32],
    onset_q: &[f32],
    sample_rate: u32,
    max_alternates: usize,
) -> Option<AlignmentReport> {
    if cr.n_frames == 0 || cq.n_frames == 0 {
        return None;
    }

    let cr_mask = active_mask(cr);
    let cq_mask = active_mask(cq);

    let raw = raw_chroma_correlation(cr, cq);
    let overlaps = overlap_counts(&cr_mask, &cq_mask);
    debug_assert_eq!(raw.len(), overlaps.len());

    let n_active_ref = cr_mask.iter().sum::<f32>() as usize;
    let n_active_query = cq_mask.iter().sum::<f32>() as usize;
    let min_active = n_active_ref.min(n_active_query);
    if min_active == 0 {
        return None;
    }
    let min_overlap = (min_active as f32 * MIN_OVERLAP_FRACTION).max(8.0);

    // Build chroma NCC: raw / sqrt(overlap_count). Where overlap is
    // below threshold, NCC = 0.
    let mut ncc_chroma = vec![0.0f32; raw.len()];
    for i in 0..raw.len() {
        let o = overlaps[i].max(0.0);
        if o < min_overlap {
            continue;
        }
        ncc_chroma[i] = raw[i] / o.sqrt();
    }

    // Optional onset-envelope NCC pass. Same correlate_full + sqrt-overlap
    // normalization, then summed with chroma NCC element-wise. We weight
    // onset lower than chroma — chroma is the primary signal, onset
    // breaks ties between similar-looking chroma regions.
    let mut ncc_combined = ncc_chroma.clone();
    if !onset_r.is_empty()
        && !onset_q.is_empty()
        && onset_r.len() + onset_q.len() - 1 == ncc_chroma.len()
    {
        const ONSET_WEIGHT: f32 = 0.4;
        // Normalize the envelopes so their NCC peak ≈ 1 (matches chroma's range).
        let r_norm_sq: f64 = onset_r.iter().map(|&x| x as f64 * x as f64).sum();
        let q_norm_sq: f64 = onset_q.iter().map(|&x| x as f64 * x as f64).sum();
        let denom = (r_norm_sq * q_norm_sq).sqrt() as f32;
        if denom > 1e-6 {
            let onset_corr = correlate_full(onset_q, onset_r);
            // Find peak chroma value to scale onset to comparable units.
            let chroma_peak = ncc_chroma.iter().cloned().fold(0.0_f32, f32::max).max(1e-6);
            for i in 0..ncc_combined.len() {
                let onset_normalized = onset_corr[i] / denom; // ~Pearson over full overlap
                if onset_normalized > 0.0 {
                    ncc_combined[i] += ONSET_WEIGHT * onset_normalized * chroma_peak;
                }
            }
        }
    }
    let ncc = ncc_combined;

    // Find primary peak.
    let mut primary_idx = 0usize;
    let mut primary_val = f32::NEG_INFINITY;
    for (i, &v) in ncc.iter().enumerate() {
        if v > primary_val {
            primary_val = v;
            primary_idx = i;
        }
    }
    if primary_val <= 0.0 {
        return None;
    }

    // Normalize NCC into [0, 1] for stable confidence reporting. With our
    // sqrt(o) denominator the theoretical max is sqrt(min_active); divide.
    let conf_norm = (min_active as f32).sqrt().max(1.0);
    let primary_ncc_norm = (primary_val / conf_norm).clamp(0.0, 1.0);

    let primary = MatchCandidate {
        offset_samples: idx_to_offset_samples(primary_idx, cr.n_frames, HOP),
        ncc: primary_ncc_norm,
        overlap_frames: overlaps[primary_idx].round() as u32,
    };

    // Alternate candidates — local maxima with the spacing constraint.
    let min_spacing_frames = (MIN_PEAK_SPACING_S * sample_rate as f32 / HOP as f32) as usize;
    let cutoff = primary_val * REL_THRESHOLD;

    // Find every strict local maximum in `ncc` that's ≥ cutoff. Then sort
    // by descending NCC and apply spacing.
    let mut peaks: Vec<(usize, f32)> = Vec::new();
    for i in 1..ncc.len() - 1 {
        if ncc[i] >= cutoff && ncc[i] > ncc[i - 1] && ncc[i] > ncc[i + 1] {
            peaks.push((i, ncc[i]));
        }
    }
    peaks.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    let mut alternates: Vec<MatchCandidate> = Vec::new();
    for (idx, val) in peaks.into_iter() {
        if idx == primary_idx {
            continue;
        }
        // Must be far enough from existing accepted peaks (and the primary).
        let too_close = std::iter::once(primary_idx)
            .chain(alternates.iter().map(|c| {
                // Map offset back to index. lag_frames = -offset/hop;
                // idx = lag_frames + (cr.n_frames - 1).
                let lag = -c.offset_samples / HOP as i64;
                (lag + cr.n_frames as i64 - 1) as usize
            }))
            .any(|other| (other as isize - idx as isize).unsigned_abs() < min_spacing_frames);
        if too_close {
            continue;
        }
        alternates.push(MatchCandidate {
            offset_samples: idx_to_offset_samples(idx, cr.n_frames, HOP),
            ncc: (val / conf_norm).clamp(0.0, 1.0),
            overlap_frames: overlaps[idx].round() as u32,
        });
        if alternates.len() >= max_alternates {
            break;
        }
    }

    Some(AlignmentReport {
        primary,
        alternates,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::chroma::chroma_features;

    fn make_song(secs: f32, sr: u32, seed: u64) -> Vec<f32> {
        let n = (secs * sr as f32) as usize;
        let mut y = vec![0.0f32; n];
        let scale = [220.0_f32, 277.18, 329.63, 392.0, 466.16];
        let mut state = seed.wrapping_mul(0x9E3779B97F4A7C15);
        let note = 0.4_f32;
        let mut t = 0.0_f32;
        while t < secs {
            state ^= state << 13;
            state ^= state >> 7;
            state ^= state << 17;
            let f = scale[(state as usize) % scale.len()];
            let start = (t * sr as f32) as usize;
            let end = ((t + note) * sr as f32) as usize;
            let end = end.min(n);
            for i in start..end {
                let tt = i as f32 / sr as f32;
                let env = (1.0 - (tt - t) / note).max(0.0);
                y[i] = 0.4 * (2.0 * std::f32::consts::PI * f * tt).sin() * env;
            }
            t += note;
        }
        y
    }

    #[test]
    fn ncc_recovers_pure_offset_2s() {
        let sr = 22050u32;
        let song = make_song(20.0, sr, 17);
        let mut reference = vec![0.0f32; (sr as f32 * 2.0) as usize];
        reference.extend_from_slice(&song);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let report = align_with_candidates(&cr, &cq, sr, 4).expect("report");
        let off_ms = report.primary.offset_samples as f64 / sr as f64 * 1000.0;
        assert!(
            (off_ms - 2000.0).abs() < 100.0,
            "off_ms = {} (expected ~2000)",
            off_ms,
        );
        assert!(report.primary.ncc > 0.5, "ncc = {}", report.primary.ncc);
    }

    #[test]
    fn ncc_returns_alternates_for_repeated_pattern() {
        // ref = master + silence + master  → there should be two valid
        // alignments (lag 0 and lag = master_length + silence_gap).
        let sr = 22050u32;
        let song = make_song(5.0, sr, 42);
        let mut reference = song.clone();
        reference.extend(vec![0.0f32; (sr as f32 * 2.0) as usize]);
        reference.extend_from_slice(&song);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let report = align_with_candidates(&cr, &cq, sr, 4).expect("report");
        // Primary should be at lag ~0.
        let primary_ms = report.primary.offset_samples as f64 / sr as f64 * 1000.0;
        // Alternate should be near +7000 ms (5000 song + 2000 gap).
        let has_secondary = report.alternates.iter().any(|c| {
            let ms = c.offset_samples as f64 / sr as f64 * 1000.0;
            (ms - 7000.0).abs() < 500.0
        });
        assert!(has_secondary, "no secondary near 7000 ms; primary={primary_ms}, alts={:?}", report.alternates);
    }
}
