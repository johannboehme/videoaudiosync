//! Shared math utilities.

/// Peak-normalize an audio buffer in-place. No-op if peak is zero.
pub fn peak_normalize(y: &mut [f32]) {
    let mut peak = 0.0f32;
    for &s in y.iter() {
        let a = s.abs();
        if a > peak {
            peak = a;
        }
    }
    if peak > 0.0 {
        for s in y.iter_mut() {
            *s /= peak;
        }
    }
}

/// Median (in-place sort, owned vec). Returns 0.0 for empty input.
pub fn median(values: &[f32]) -> f32 {
    if values.is_empty() {
        return 0.0;
    }
    let mut sorted: Vec<f32> = values.to_vec();
    sorted.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let n = sorted.len();
    if n % 2 == 0 {
        0.5 * (sorted[n / 2 - 1] + sorted[n / 2])
    } else {
        sorted[n / 2]
    }
}

/// Linear regression `y = m*x + b`, returns (slope, intercept).
/// Returns (1.0, 0.0) when fewer than 2 points or zero variance.
pub fn polyfit_linear(xs: &[f64], ys: &[f64]) -> (f64, f64) {
    debug_assert_eq!(xs.len(), ys.len());
    let n = xs.len();
    if n < 2 {
        return (1.0, 0.0);
    }
    let mean_x = xs.iter().sum::<f64>() / n as f64;
    let mean_y = ys.iter().sum::<f64>() / n as f64;
    let mut num = 0.0;
    let mut den = 0.0;
    for i in 0..n {
        let dx = xs[i] - mean_x;
        num += dx * (ys[i] - mean_y);
        den += dx * dx;
    }
    if den.abs() < 1e-12 {
        return (1.0, mean_y - mean_x);
    }
    let slope = num / den;
    let intercept = mean_y - slope * mean_x;
    (slope, intercept)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn peak_normalize_scales_to_one() {
        let mut y = vec![0.1, -0.4, 0.2];
        peak_normalize(&mut y);
        let peak = y.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
        assert!((peak - 1.0).abs() < 1e-6);
    }

    #[test]
    fn peak_normalize_handles_zero_input() {
        let mut y = vec![0.0, 0.0, 0.0];
        peak_normalize(&mut y);
        assert!(y.iter().all(|&x| x == 0.0));
    }

    #[test]
    fn median_odd() {
        assert!((median(&[3.0, 1.0, 2.0]) - 2.0).abs() < 1e-9);
    }

    #[test]
    fn median_even() {
        assert!((median(&[3.0, 1.0, 2.0, 4.0]) - 2.5).abs() < 1e-9);
    }

    #[test]
    fn polyfit_recovers_known_line() {
        let xs: Vec<f64> = (0..100).map(|i| i as f64).collect();
        let ys: Vec<f64> = xs.iter().map(|&x| 1.5 * x + 7.0).collect();
        let (m, b) = polyfit_linear(&xs, &ys);
        assert!((m - 1.5).abs() < 1e-9, "slope = {}", m);
        assert!((b - 7.0).abs() < 1e-9, "intercept = {}", b);
    }
}
