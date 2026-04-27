//! Dynamic Time Warping over cosine distance for chroma matrices.
//!
//! Mirrors the backend's DTW fallback (`librosa.sequence.dtw(metric="cosine")`):
//! given two sequences of L2-normalized chroma vectors, find the
//! minimum-cost monotonic path through the cost matrix where
//!     cost(i, j) = 1 - cosine(ref[:, i], query[:, j])
//! Then linear-fit `query_pos = m * ref_pos + b` to the path to extract
//! drift and offset.
//!
//! Memory: O(N*M) cells. For 90s audio at hop=1024 (sr=22050),
//! N ≈ M ≈ 1940 frames → 3.8 M cells × 8 bytes = ~30 MB. Acceptable.
//! For longer recordings the caller should use a larger hop.

use crate::chroma::{ChromaMatrix, N_PITCH_CLASSES};
use crate::util::polyfit_linear;

/// Returns the warp path in (ref_frame, query_frame) pairs, in order from
/// (0, 0) to (N-1, M-1). The frames are indices into the chroma matrices.
pub fn dtw_warp_path(ref_chroma: &ChromaMatrix, query_chroma: &ChromaMatrix) -> Vec<(usize, usize)> {
    let n = ref_chroma.n_frames;
    let m = query_chroma.n_frames;
    if n == 0 || m == 0 {
        return Vec::new();
    }

    // Cost matrix: cost[i][j] = 1 - cosine(ref[:, i], query[:, j])
    // Both inputs are L2-normalized per frame, so cosine = dot product.
    let mut cost = vec![0.0f32; n * m];
    for i in 0..n {
        for j in 0..m {
            let mut dot = 0.0f32;
            for c in 0..N_PITCH_CLASSES {
                dot += ref_chroma.row(c)[i] * query_chroma.row(c)[j];
            }
            cost[i * m + j] = 1.0 - dot;
        }
    }

    // Accumulated cost matrix.
    let mut acc = vec![f32::INFINITY; n * m];
    acc[0] = cost[0];
    for j in 1..m {
        acc[j] = acc[j - 1] + cost[j];
    }
    for i in 1..n {
        acc[i * m] = acc[(i - 1) * m] + cost[i * m];
    }
    for i in 1..n {
        for j in 1..m {
            let a = acc[(i - 1) * m + (j - 1)];
            let b = acc[(i - 1) * m + j];
            let c = acc[i * m + (j - 1)];
            let min = a.min(b).min(c);
            acc[i * m + j] = cost[i * m + j] + min;
        }
    }

    // Backtrack from (n-1, m-1) → (0, 0).
    let mut path = Vec::with_capacity(n + m);
    let mut i = n - 1;
    let mut j = m - 1;
    path.push((i, j));
    while i > 0 || j > 0 {
        let (ni, nj) = if i == 0 {
            (0, j - 1)
        } else if j == 0 {
            (i - 1, 0)
        } else {
            let a = acc[(i - 1) * m + (j - 1)];
            let b = acc[(i - 1) * m + j];
            let c = acc[i * m + (j - 1)];
            if a <= b && a <= c {
                (i - 1, j - 1)
            } else if b <= c {
                (i - 1, j)
            } else {
                (i, j - 1)
            }
        };
        i = ni;
        j = nj;
        path.push((i, j));
    }
    path.reverse();
    path
}

/// Returns (offset_samples, drift_ratio) from a DTW warp path.
/// Convention matches backend `_dtw_drift`: positive offset means the studio (query)
/// should be DELAYED in the video (ref) timeline.
pub fn dtw_drift(
    ref_chroma: &ChromaMatrix,
    query_chroma: &ChromaMatrix,
    hop: usize,
) -> (f64, f64) {
    let path = dtw_warp_path(ref_chroma, query_chroma);
    if path.len() < 8 {
        return (0.0, 1.0);
    }
    let xs: Vec<f64> = path.iter().map(|&(i, _)| (i as f64) * hop as f64).collect();
    let ys: Vec<f64> = path.iter().map(|&(_, j)| (j as f64) * hop as f64).collect();
    let (m, b) = polyfit_linear(&xs, &ys);
    // qf = m * rf + b. offset = rf - qf = -b at rf = 0.
    (-b, m)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn flat_chroma(values: &[[f32; N_PITCH_CLASSES]]) -> ChromaMatrix {
        let n = values.len();
        let mut data = vec![0.0f32; N_PITCH_CLASSES * n];
        for (t, row) in values.iter().enumerate() {
            // L2-normalize each input row.
            let mut norm: f32 = row.iter().map(|x| x * x).sum::<f32>().sqrt();
            if norm < 1e-9 {
                norm = 1.0;
            }
            for c in 0..N_PITCH_CLASSES {
                data[c * n + t] = row[c] / norm;
            }
        }
        ChromaMatrix { data, n_frames: n }
    }

    #[test]
    fn identical_sequences_have_diagonal_path() {
        let mut row_a = [0.0f32; N_PITCH_CLASSES];
        row_a[0] = 1.0;
        let mut row_b = [0.0f32; N_PITCH_CLASSES];
        row_b[3] = 1.0;
        let mut row_c = [0.0f32; N_PITCH_CLASSES];
        row_c[7] = 1.0;
        let seq = vec![row_a, row_b, row_c, row_a];
        let cm = flat_chroma(&seq);
        let path = dtw_warp_path(&cm, &cm);
        assert_eq!(path.first(), Some(&(0, 0)));
        assert_eq!(path.last(), Some(&(3, 3)));
        // Diagonal: each step advances both i and j.
        for w in path.windows(2) {
            let (a, b) = (w[0], w[1]);
            assert!(b.0 >= a.0 && b.1 >= a.1);
        }
    }

    #[test]
    fn dtw_drift_recovers_offset_zero_drift_one_for_identical() {
        let mut row_a = [0.0f32; N_PITCH_CLASSES];
        row_a[0] = 1.0;
        let mut row_b = [0.0f32; N_PITCH_CLASSES];
        row_b[3] = 1.0;
        let mut row_c = [0.0f32; N_PITCH_CLASSES];
        row_c[7] = 1.0;
        let seq = vec![
            row_a, row_b, row_c, row_a, row_b, row_c, row_a, row_b, row_c, row_a,
        ];
        let cm = flat_chroma(&seq);
        let (offset, drift) = dtw_drift(&cm, &cm, 512);
        assert!(offset.abs() < 1.0, "offset should be ≈ 0, got {}", offset);
        assert!((drift - 1.0).abs() < 0.05, "drift should be ≈ 1, got {}", drift);
    }
}
