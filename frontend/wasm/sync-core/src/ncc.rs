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
use crate::util::median;
use crate::xcorr::correlate_full;

/// Minimum joint-active fraction of the shorter signal we require at a
/// candidate lag. Below this we set NCC to 0 (i.e. ignore the lag).
const MIN_OVERLAP_FRACTION: f32 = 0.20;

/// Hard floor (in seconds) on the joint-active overlap a candidate lag
/// needs to be considered. The fraction above is enough to throw out
/// trivial 2–3-frame edge matches, but a 5 % overlap on a 30 s query
/// (= 1.5 s actual) already includes plausibly-sized but wildly
/// unreliable picks; a 1 s floor moves the bar to where sample-level
/// Pearson and onset Pearson can both stabilize. Sub-second queries
/// (rare in multi-cam edits) intentionally bypass via `max(8, …)`.
const MIN_OVERLAP_SECONDS: f32 = 1.0;

/// Minimum spacing between alternate candidates, in seconds. Two peaks
/// closer than this collapse into one (the higher). 0.25 s lets us
/// surface near-duplicate peaks at sub-beat distances — important for
/// the snap-to-alternate UI on rhythmic music where beat-aligned wrong
/// peaks cluster around the true peak.
const MIN_PEAK_SPACING_S: f32 = 0.25;

/// Onset-envelope contribution weight in `align_with_onset`. The
/// per-lag onset-cross-correlation (Pearson, ~[0,1]) is scaled by this
/// and by the chroma peak before being added into `ncc_combined` to
/// pick the winning peak. Onset carries more weight than chroma because
/// chroma rewards every beat-grid-aligned position equally on
/// repetitive material — onset is the only feature that knows where the
/// unique transients sit.
///
/// Onset only influences peak SELECTION; the confidence value reported
/// for each candidate is the chroma-only NCC at the chosen lag, so the
/// user-facing scale stays in chroma-only units regardless of how
/// strongly onset tilted the pick.
///
/// (Tier 1.1 attempted to fold onset multiplicatively into the score
/// itself; on the real-music bench it slightly *reduced* mean PSR
/// because rhythmic material has near-uniform onset Pearson at every
/// beat-aligned lag — the bonus rewarded false alignments almost as
/// much as the true one. Reverted in favor of GCC-PHAT (Tier 2) for
/// real same-source disambiguation. Margin metrics from Tier 1.2 still
/// give the UI a way to see the tightness in `peak_to_second_ratio`.)
const ONSET_WEIGHT: f32 = 0.85;

/// Alternate candidates with NCC below `top_ncc * REL_THRESHOLD` are
/// dropped. 0.3 is loose enough to surface beat-shifted near-misses, which
/// is what the snap-to-alternate-match UI wants to suggest when chroma's
/// global peak picks the wrong beat in a self-similar piece of music.
const REL_THRESHOLD: f32 = 0.3;

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

/// How sharply the primary peak stands above the rest of the correlation
/// surface. The reported chroma NCC alone collapses everything into [0, 1]
/// and on real music routinely sits at 0.95–1.00 even when the second
/// peak is fractionally below — the margin disappears in the rounding.
/// These metrics surface that margin so the UI can distinguish a clear
/// pick from a knife-edge tie. Both are computed on the ranking array
/// (chroma + onset fusion when onset is supplied) so they reflect what
/// the picker actually saw, not the post-clamp confidence number.
#[derive(Debug, Clone, Copy, Default)]
pub struct DiscriminationStats {
    /// Primary peak / second-highest local maximum on the ranking array.
    /// 1.0 = tie, 2.0 = primary twice as strong as runner-up. `f32::MAX`
    /// when there is no second peak (single isolated maximum).
    pub peak_to_second_ratio: f32,
    /// Primary peak / median of the ranking array over the valid-overlap
    /// region. A "noise floor" comparison: how exceptional the chosen
    /// lag is relative to the bulk of the correlation surface.
    /// `f32::MAX` when the median is effectively zero (degenerate input).
    pub peak_to_noise: f32,
}

#[derive(Debug, Clone)]
pub struct AlignmentReport {
    pub primary: MatchCandidate,
    /// Up to N alternate candidates with NCC ≥ REL_THRESHOLD * primary.ncc,
    /// sorted descending by NCC. Used for "snap to alternate match" UI.
    pub alternates: Vec<MatchCandidate>,
    pub discrimination: DiscriminationStats,
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

/// Sub-frame peak-position refinement via parabolic interpolation across
/// three neighboring NCC samples. Returns the integer-frame `idx`
/// shifted by a fractional amount in (-0.5, +0.5) frames; converted to
/// audio samples this collapses the visible 23 ms quantization step
/// (HOP=512 @ 22050 Hz) into ~3–5 ms residual error on average. Returns
/// `None` for boundary peaks or near-flat tops where the closed-form
/// formula is numerically unstable.
fn refine_peak_offset_samples(
    ncc: &[f32],
    idx: usize,
    n_ref_frames: usize,
    hop: usize,
) -> i64 {
    let base = idx_to_offset_samples(idx, n_ref_frames, hop);
    if idx == 0 || idx + 1 >= ncc.len() {
        return base;
    }
    let a = ncc[idx - 1];
    let b = ncc[idx];
    let c = ncc[idx + 1];
    let denom = a - 2.0 * b + c;
    // Near-flat top (denom ≈ 0) or upward-curving (denom > 0, not a
    // maximum) — interpolation result would be meaningless or out of
    // [-1, +1]. Skip refinement.
    if denom.abs() < 1e-9 || denom > 0.0 {
        return base;
    }
    let delta = 0.5 * (a - c) / denom;
    if !delta.is_finite() || delta.abs() > 1.0 {
        return base;
    }
    // `delta` is the offset in chroma frames toward where the true peak
    // lies between samples [idx-1, idx, idx+1]. Each frame is `hop`
    // audio samples; positive delta = peak shifted right of `idx`. The
    // existing idx_to_offset_samples convention has *higher* idx mapping
    // to *more negative* sample lag (see fn body), so a positive
    // delta-frames shift means we should SUBTRACT delta * hop from the
    // base sample offset to track the true peak.
    let frac_samples = (delta * hop as f32).round() as i64;
    base - frac_samples
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
    // Floor on overlap: the existing 20 %-of-shorter rule (and the 8-frame
    // absolute minimum) lets too-thin overlaps through on long queries.
    // Add a 1-second seconds-based floor that kicks in when the fraction
    // is too lax — but cap the floor at 80 % of the shorter signal so
    // sub-second queries (rare but legal) don't get trivially rejected.
    let frames_per_sec = sample_rate as f32 / HOP as f32;
    let seconds_floor = (MIN_OVERLAP_SECONDS * frames_per_sec).min(min_active as f32 * 0.8);
    let min_overlap = (min_active as f32 * MIN_OVERLAP_FRACTION)
        .max(8.0)
        .max(seconds_floor);

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
    // normalization, then summed into ncc_combined element-wise. Onset
    // is folded in only as a peak-PICKER tiebreaker — it shifts which
    // lag wins among self-similar chroma regions but doesn't affect the
    // reported confidence (which stays chroma-only, see conf_norm
    // below). Real-music bench on 30 s pop chunks @ 64–128 BPM needs
    // onset ≥ chroma here to consistently pick the true alignment over
    // a beat-shifted impostor.
    let onset_denom = if !onset_r.is_empty()
        && !onset_q.is_empty()
        && onset_r.len() + onset_q.len() - 1 == ncc_chroma.len()
    {
        let r_norm_sq: f64 = onset_r.iter().map(|&x| x as f64 * x as f64).sum();
        let q_norm_sq: f64 = onset_q.iter().map(|&x| x as f64 * x as f64).sum();
        let d = (r_norm_sq * q_norm_sq).sqrt() as f32;
        if d > 1e-6 { Some(d) } else { None }
    } else {
        None
    };

    let mut ncc_combined = ncc_chroma.clone();
    if let Some(denom) = onset_denom {
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

    // Normalize NCC into [0, 1] for stable confidence reporting. The
    // reported NCC is strictly the chroma-only Pearson at the chosen
    // lag, normalised by the chroma-only theoretical max sqrt(min_active).
    // This keeps the user-facing scale stable across onset-active and
    // onset-empty paths (~0.85 for solid matches, ~0.5 for shaky ones)
    // — onset is a peak-picker, not a confidence multiplier.
    let conf_norm = (min_active as f32).sqrt().max(1.0);
    let primary_ncc_norm = (ncc_chroma[primary_idx] / conf_norm).clamp(0.0, 1.0);

    let primary = MatchCandidate {
        offset_samples: refine_peak_offset_samples(&ncc, primary_idx, cr.n_frames, HOP),
        ncc: primary_ncc_norm,
        overlap_frames: overlaps[primary_idx].round() as u32,
    };

    // Alternate candidates — local maxima with the spacing constraint.
    // Peaks are picked from the boosted `ncc` (onset breaks chroma ties)
    // but their reported confidence is again the chroma-only value at
    // that lag, same normalization as primary.
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

    // Discrimination stats — surface how sharply primary stands above the
    // rest of the surface. Computed on `ncc` (the same array peaks were
    // selected from), so the metric tracks whatever fusion the picker
    // used. A "tie" PSR ≈ 1.0 means the next runner-up is essentially as
    // good as the chosen lag — the UI should mark it as ambiguous even
    // though `confidence` will round to 1.0.
    let second_peak_val = peaks
        .iter()
        .find(|(i, _)| *i != primary_idx)
        .map(|(_, v)| *v);
    let peak_to_second_ratio = match second_peak_val {
        Some(v) if v > 1e-6 => primary_val / v,
        _ => f32::MAX,
    };
    let valid_values: Vec<f32> = ncc.iter().copied().filter(|&v| v > 0.0).collect();
    let med = median(&valid_values);
    let peak_to_noise = if med > 1e-6 { primary_val / med } else { f32::MAX };
    let discrimination = DiscriminationStats {
        peak_to_second_ratio,
        peak_to_noise,
    };

    // Track integer-frame indices separately from the (possibly
    // sub-frame-refined) offset_samples so spacing stays exact: the
    // refinement shifts offset_samples by up to ±HOP/2, which the old
    // `lag = -offset / HOP` round-trip would corrupt.
    let mut accepted_idxs: Vec<usize> = vec![primary_idx];
    let mut alternates: Vec<MatchCandidate> = Vec::new();
    for (idx, _val) in peaks.into_iter() {
        if idx == primary_idx {
            continue;
        }
        let too_close = accepted_idxs
            .iter()
            .any(|&other| (other as isize - idx as isize).unsigned_abs() < min_spacing_frames);
        if too_close {
            continue;
        }
        accepted_idxs.push(idx);
        alternates.push(MatchCandidate {
            offset_samples: refine_peak_offset_samples(&ncc, idx, cr.n_frames, HOP),
            ncc: (ncc_chroma[idx] / conf_norm).clamp(0.0, 1.0),
            overlap_frames: overlaps[idx].round() as u32,
        });
        if alternates.len() >= max_alternates {
            break;
        }
    }

    Some(AlignmentReport {
        primary,
        alternates,
        discrimination,
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

    /// Regression: previously the conf_norm normalization in
    /// `align_with_onset` ignored the onset boost (`ONSET_WEIGHT *
    /// onset_normalized * chroma_peak` added per-lag at ncc.rs:239-243),
    /// so alternates whose onset-augmented value `val` exceeded
    /// `sqrt(min_active)` clamped to 1.0 — they lost their relative
    /// ranking and the snap-to-match UI showed every candidate as 100%.
    /// The fix scales `conf_norm` by `(1 + ONSET_WEIGHT)` when onset is
    /// active. Setup: full song followed by silence then 80% of the song
    /// — alternate at lag ≈ song_len + silence has chroma slightly weaker
    /// than primary; with the bug both clamp to 1.0, post-fix they
    /// differentiate.
    #[test]
    fn align_with_onset_alternates_dont_saturate_at_one() {
        let sr = 22050u32;
        let song = make_song(5.0, sr, 42);
        let partial_len = (song.len() as f32 * 0.8) as usize;
        let mut reference = song.clone();
        reference.extend(vec![0.0f32; (sr as f32 * 2.0) as usize]);
        reference.extend_from_slice(&song[..partial_len]);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let onset_r = crate::onset::onset_envelope(&reference, sr);
        let onset_q = crate::onset::onset_envelope(&song, sr);
        let report = align_with_onset(&cr, &cq, &onset_r, &onset_q, sr, 4)
            .expect("report");
        assert!(
            !report.alternates.is_empty(),
            "expected at least one alternate; got {:?}",
            report.alternates,
        );
        // The alternate at the partial-song repeat (lag ≈ +7000 ms, since
        // primary is at lag 0 and song+silence = 5+2 s) is the one the
        // bug saturated. After the fix it must report sub-1.0 confidence.
        let partial_alt = report.alternates.iter().find(|c| {
            let ms = c.offset_samples as f64 / sr as f64 * 1000.0;
            (ms - 7000.0).abs() < 500.0
        });
        let alt = partial_alt.unwrap_or_else(|| {
            panic!(
                "no alternate near lag +7000 ms found; alts={:?}",
                report.alternates,
            )
        });
        assert!(
            alt.ncc < 0.95,
            "partial-repeat alternate must be sub-1.0 to differentiate \
             from primary (bug = both clamped to 1.0); primary.ncc={} \
             alt.ncc={}",
            report.primary.ncc,
            alt.ncc,
        );
        assert!(
            report.primary.ncc > alt.ncc,
            "primary should outrank the partial-repeat alternate; \
             primary.ncc={} alt.ncc={}",
            report.primary.ncc,
            alt.ncc,
        );
    }

    /// Tier 1.4: a 30 s query against a 60 s ref still finds the right
    /// alignment when the seconds-based overlap floor kicks in, but a
    /// trivial 0.05 s edge-match on a 60 s ref does NOT pass — the
    /// floor closes the "lag where 3 frames happen to align" loophole.
    #[test]
    fn min_overlap_floor_keeps_normal_alignment() {
        let sr = 22050u32;
        let song = make_song(30.0, sr, 7);
        let mut reference = vec![0.0f32; (sr as f32 * 1.0) as usize];
        reference.extend_from_slice(&song);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let report = align_with_candidates(&cr, &cq, sr, 4).expect("report");
        let off_ms = report.primary.offset_samples as f64 / sr as f64 * 1000.0;
        assert!(
            (off_ms - 1000.0).abs() < 100.0,
            "expected ~+1000ms; got {}",
            off_ms,
        );
    }

    /// Tier 1.3: parabolic peak refinement must collapse the 23 ms hop
    /// quantization for offsets that don't fall on hop-multiples.
    /// Setup: a 137-ms shift (≈ 5.9 hops, very off-grid). Without
    /// refinement the integer-hop result rounds to the nearest hop
    /// (~12 ms residual). With refinement the residual must drop below
    /// half a hop.
    #[test]
    fn parabolic_refinement_shrinks_off_grid_residual() {
        let sr = 22050u32;
        let song = make_song(15.0, sr, 451);
        let pad_samples = (0.137 * sr as f32) as usize; // 137 ms — not a hop multiple
        let mut reference = vec![0.0f32; pad_samples];
        reference.extend_from_slice(&song);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let report = align_with_candidates(&cr, &cq, sr, 4).expect("report");
        let off_ms = report.primary.offset_samples as f64 / sr as f64 * 1000.0;
        let residual_ms = (off_ms - 137.0).abs();
        assert!(
            residual_ms < 12.0,
            "refined residual must be sub-half-hop (<12 ms) for off-grid \
             137 ms shift; got off_ms={} residual={}",
            off_ms,
            residual_ms,
        );
    }

    /// Tier 1.3 numerical edge cases: peaks at the boundary or with a
    /// flat top must NOT corrupt the offset (the closed-form parabola
    /// is undefined there). The function should fall back to the
    /// integer-hop offset.
    #[test]
    fn parabolic_refinement_handles_boundary_and_flat_peaks() {
        // Boundary at idx=0
        let ncc = vec![5.0, 4.0, 3.0, 2.0];
        let n_ref = 2;
        let hop = 512;
        let base = idx_to_offset_samples(0, n_ref, hop);
        assert_eq!(refine_peak_offset_samples(&ncc, 0, n_ref, hop), base);

        // Boundary at idx=len-1
        let last = ncc.len() - 1;
        let base_last = idx_to_offset_samples(last, n_ref, hop);
        assert_eq!(refine_peak_offset_samples(&ncc, last, n_ref, hop), base_last);

        // Flat top: a == b == c → denom == 0
        let flat = vec![1.0, 1.0, 1.0];
        let base_flat = idx_to_offset_samples(1, n_ref, hop);
        assert_eq!(refine_peak_offset_samples(&flat, 1, n_ref, hop), base_flat);

        // Upward curve (denom > 0) — not a maximum; refinement skipped.
        let upward = vec![1.0, 2.0, 4.0]; // a-2b+c = 1-4+4 = 1 > 0
        let base_up = idx_to_offset_samples(1, n_ref, hop);
        assert_eq!(refine_peak_offset_samples(&upward, 1, n_ref, hop), base_up);
    }

    /// Tier 1.2: discrimination stats must be populated and sane.
    /// Identity input has a strong, isolated primary peak; PSR should be
    /// well above 1.0 and PNR even higher (median of an autocorrelation
    /// surface is far below the peak).
    #[test]
    fn discrimination_stats_strong_for_identity() {
        let sr = 22050u32;
        let song = make_song(20.0, sr, 17);
        let cr = chroma_features(&song, sr);
        let cq = chroma_features(&song, sr);
        let report = align_with_candidates(&cr, &cq, sr, 4).expect("report");
        assert!(
            report.discrimination.peak_to_second_ratio > 1.0,
            "psr should be >1 for identity; got {}",
            report.discrimination.peak_to_second_ratio,
        );
        assert!(
            report.discrimination.peak_to_noise > 2.0,
            "pnr should be >2 for identity (peak much higher than median); got {}",
            report.discrimination.peak_to_noise,
        );
    }

    /// Tier 1.2: when ref contains the master twice, two near-equal peaks
    /// exist. PSR should sit close to 1.0 — the metric exposes the
    /// ambiguity that `confidence` alone hides (chroma NCC clamps to ~1
    /// for both).
    #[test]
    fn discrimination_psr_drops_for_repeated_pattern() {
        let sr = 22050u32;
        let song = make_song(5.0, sr, 42);
        let mut reference = song.clone();
        reference.extend(vec![0.0f32; (sr as f32 * 2.0) as usize]);
        reference.extend_from_slice(&song);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let report = align_with_candidates(&cr, &cq, sr, 4).expect("report");
        assert!(
            report.discrimination.peak_to_second_ratio < 1.5,
            "psr should be near 1.0 for self-repeating ref \
             (two near-equal peaks); got {}",
            report.discrimination.peak_to_second_ratio,
        );
    }

    /// Non-regression guard: when called with empty onset slices,
    /// `align_with_onset` MUST produce bit-exact identical output to
    /// `align_with_candidates`. This guards against accidentally coupling
    /// the chroma-only path to the new onset-aware conf_norm scaling.
    #[test]
    fn align_with_onset_empty_onsets_matches_legacy_path() {
        let sr = 22050u32;
        let song = make_song(8.0, sr, 99);
        let mut reference = vec![0.0f32; (sr as f32 * 1.5) as usize];
        reference.extend_from_slice(&song);
        let cr = chroma_features(&reference, sr);
        let cq = chroma_features(&song, sr);
        let legacy = align_with_candidates(&cr, &cq, sr, 4).expect("legacy");
        let onset_path =
            align_with_onset(&cr, &cq, &[], &[], sr, 4).expect("onset path");
        assert_eq!(
            legacy.primary.offset_samples,
            onset_path.primary.offset_samples,
        );
        assert_eq!(legacy.primary.ncc, onset_path.primary.ncc);
        assert_eq!(legacy.alternates.len(), onset_path.alternates.len());
        for (a, b) in legacy.alternates.iter().zip(onset_path.alternates.iter()) {
            assert_eq!(a.offset_samples, b.offset_samples);
            assert_eq!(a.ncc, b.ncc);
        }
    }
}
