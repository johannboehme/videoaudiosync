"""Audio-to-audio synchronization.

Pipeline:
  1. Load both audios at SR (default 22050) mono, normalize.
  2. FFT-cross-correlation → coarse offset (sub-sample via parabolic refinement).
  3. Compute peak-to-median ratio as confidence.
  4. If confidence below threshold OR drift suspected: chroma + DTW for non-linear alignment
     and detect linear drift slope.
  5. Sanity-check correlation at 3 windows along the file.

Returns SyncResult with offset_ms (positive = studio lags video) and confidence.
"""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import numpy as np

from app.config import settings


@dataclass(slots=True)
class SyncResult:
    offset_ms: float  # ms to shift studio relative to video to align
    confidence: float  # 0..1, peak/median of correlation
    drift_ratio: float  # 1.0 = no drift; e.g. 1.0005 = studio runs 0.05% slow vs video
    method: str  # "xcorr" | "xcorr+dtw"
    warning: str | None = None


def _load(path: Path, sr: int) -> np.ndarray:
    import librosa

    y, _ = librosa.load(str(path), sr=sr, mono=True)
    if y.size == 0:
        return y
    # peak-normalize for stable correlation magnitude
    peak = float(np.max(np.abs(y)))
    if peak > 0:
        y = y / peak
    return y


_CHROMA_HOP = 512


def _chroma_features(y: np.ndarray, sr: int) -> np.ndarray:
    """12 x T chroma matrix, L2-normalized per frame for cosine-correlation friendliness."""
    import librosa

    if y.size == 0:
        return np.zeros((12, 0), dtype=np.float32)
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr, hop_length=_CHROMA_HOP)
    norms = np.linalg.norm(chroma, axis=0, keepdims=True)
    norms[norms < 1e-9] = 1.0
    return (chroma / norms).astype(np.float32)


def _chroma_alignment(
    ref: np.ndarray, query: np.ndarray, sr: int
) -> tuple[int, float, np.ndarray, np.ndarray]:
    """Returns (offset_samples, chroma_confidence, cr, cq).

    offset convention: positive = studio (query) should be delayed in video (ref) timeline.
    """
    from scipy.signal import correlate

    cr = _chroma_features(ref, sr)
    cq = _chroma_features(query, sr)
    if cr.shape[1] == 0 or cq.shape[1] == 0:
        return 0, 0.0, cr, cq

    n_full = cr.shape[1] + cq.shape[1] - 1
    accum = np.zeros(n_full, dtype=np.float64)
    for d in range(12):
        accum += correlate(cq[d], cr[d], mode="full", method="fft")
    peak_idx = int(np.argmax(accum))
    lag_frames = peak_idx - (cr.shape[1] - 1)
    offset_samples = int(-lag_frames * _CHROMA_HOP)
    confidence = _chroma_confidence_at_offset(cr, cq, offset_samples)
    return offset_samples, confidence, cr, cq


def _windowed_drift_refinement(
    ref: np.ndarray,
    query: np.ndarray,
    sr: int,
    coarse_offset_samples: int,
    n_windows: int = 8,
    win_seconds: float = 10.0,
    search_radius_seconds: float = 5.0,
    min_peak_to_median: float = 6.0,
    min_rms: float = 0.005,
) -> tuple[int, float] | None:
    """Refine (offset, drift) using sliding time-domain correlation windows.

    Slides ``n_windows`` windows of ``win_seconds`` across ref. For each window,
    cross-correlates against a slice of query around the coarse-aligned position
    (within ±``search_radius_seconds``) and records where the best match landed.
    Fits a line ``query_pos = drift * ref_pos + intercept`` to the matches.

    Returns ``(offset_samples, drift_ratio)`` if the fit is reliable, else ``None``.
    Reliability requires at least 3 high-confidence (peak/median) matches.

    drift_ratio > 1 means query progresses faster than ref (i.e. query plays "longer"
    in seconds for the same musical content), so the studio file needs to be
    sped up by drift_ratio to match the phone (atempo=drift_ratio).
    """
    from scipy.signal import correlate

    if ref.size < int(win_seconds * sr) * 2:
        return None  # too short for reliable drift estimation

    win_samples = int(win_seconds * sr)
    radius_samples = int(search_radius_seconds * sr)

    # Place windows evenly across the ref signal, skipping the very first/last 5%
    margin = int(0.05 * ref.size)
    if ref.size - 2 * margin - win_samples <= 0:
        return None
    positions = np.linspace(margin, ref.size - margin - win_samples, n_windows).astype(int)

    matches: list[tuple[float, float, float]] = []  # (ref_t, query_t, score)
    for p in positions:
        ref_w = ref[p : p + win_samples]
        if float(np.sqrt(np.mean(ref_w**2))) < min_rms:
            continue  # ref window too quiet to match against

        # Search inside query[approx_q_pos ± radius]. The "approximate" query position
        # is where the coarse alignment thinks this ref position lives:
        #     query_pos ≈ ref_pos - coarse_offset_samples
        approx_q = p - coarse_offset_samples
        q_lo = max(0, approx_q - radius_samples)
        q_hi = min(query.size, approx_q + win_samples + radius_samples)
        if q_hi - q_lo < win_samples:
            continue
        q_chunk = query[q_lo:q_hi]

        c = correlate(q_chunk, ref_w, mode="valid", method="fft")
        abs_c = np.abs(c)
        peak = int(np.argmax(abs_c))
        peak_score = float(abs_c[peak] / (np.median(abs_c) + 1e-9))
        if peak_score < min_peak_to_median:
            continue
        # Best query position (in absolute query coords) for this ref window
        q_pos = q_lo + peak
        matches.append((p / sr, q_pos / sr, peak_score))

    if len(matches) < 3:
        return None

    refs_s = np.array([m[0] for m in matches])
    queries_s = np.array([m[1] for m in matches])
    # query_pos = drift * ref_pos + intercept
    drift, intercept_s = np.polyfit(refs_s, queries_s, 1)
    # Convention: at ref_pos=0, query_pos=intercept_s. offset = ref_pos - query_pos = -intercept_s.
    offset_samples = int(round(-intercept_s * sr))
    return offset_samples, float(drift)


def _chroma_confidence_at_offset(
    cr: np.ndarray, cq: np.ndarray, offset_samples: int
) -> float:
    """Mean per-frame cosine of chroma vectors at the proposed alignment, in [0, 1].

    Both inputs are already L2-normalized per frame, so per-frame dot product is the
    cosine. Frames with no overlap are skipped.
    """
    if cr.shape[1] == 0 or cq.shape[1] == 0:
        return 0.0
    lag_frames = -int(round(offset_samples / _CHROMA_HOP))
    # ref frame i ↔ query frame i + lag_frames
    start_i = max(0, -lag_frames)
    end_i = min(cr.shape[1], cq.shape[1] - lag_frames)
    if end_i <= start_i:
        return 0.0
    a = cr[:, start_i:end_i]
    b = cq[:, start_i + lag_frames : end_i + lag_frames]
    per_frame_cos = np.sum(a * b, axis=0)  # in [-1, 1], typically [0, 1]
    return float(np.clip(np.mean(per_frame_cos), 0.0, 1.0))




def _dtw_drift(ref: np.ndarray, query: np.ndarray, sr: int) -> tuple[float, float]:
    """Returns (offset_samples, drift_ratio) using the same offset convention as the
    rest of the module: positive offset = studio (query) should be delayed in video.

    drift_ratio: query speed relative to ref (1.0 = no drift, >1 = query plays faster).
    """
    import librosa

    hop = 1024
    chroma_r = librosa.feature.chroma_cqt(y=ref, sr=sr, hop_length=hop)
    chroma_q = librosa.feature.chroma_cqt(y=query, sr=sr, hop_length=hop)
    _, wp = librosa.sequence.dtw(X=chroma_r, Y=chroma_q, metric="cosine")
    wp = wp[::-1]
    if len(wp) < 8:
        return 0.0, 1.0
    rf = wp[:, 0].astype(np.float64) * hop
    qf = wp[:, 1].astype(np.float64) * hop
    # qf = m * rf + b: at ref position rf, the corresponding query position is qf.
    # Same musical moment: ref pos rf ↔ query pos qf. offset = rf - qf = -b (at rf=0).
    # drift ratio: how much faster query advances per ref sample = m.
    m, b = np.polyfit(rf, qf, 1)
    return float(-b), float(m)


def sync_audio(
    video_audio_path: Path,
    studio_audio_path: Path,
    sr: int | None = None,
    confidence_threshold: float = 0.4,
) -> SyncResult:
    """Synchronously compute sync (CPU-bound — call via run_in_executor).

    Convention: positive offset_ms means the STUDIO should be DELAYED by that many ms
    when overlaid on the video. (i.e., the song starts later in the video timeline.)
    """
    sr = sr or settings.sample_rate
    ref = _load(video_audio_path, sr)  # the noisy phone audio = reference timeline
    query = _load(studio_audio_path, sr)  # clean studio audio = the thing we're aligning

    if ref.size == 0 or query.size == 0:
        return SyncResult(0.0, 0.0, 1.0, "chroma", "Empty audio")

    lag, confidence, cr, cq = _chroma_alignment(ref, query, sr)
    method = "chroma"
    drift = 1.0
    warning: str | None = None

    if confidence < confidence_threshold:
        method = "chroma+dtw"
        try:
            dtw_offset_samples, drift_dtw = _dtw_drift(ref, query, sr)
            lag_dtw = int(round(dtw_offset_samples))
            conf_dtw = _chroma_confidence_at_offset(cr, cq, lag_dtw)
            if conf_dtw > confidence:
                lag, confidence, drift = lag_dtw, conf_dtw, drift_dtw
        except Exception as exc:  # noqa: BLE001
            warning = f"DTW fallback failed: {exc}"

    # Always run sliding-window refinement to catch clock drift that chroma's flat
    # confidence landscape can't see. Chroma's offset is the median over the song;
    # for drift > 0.1 % over a 3-min recording, that median value leaves the start
    # and end visibly off. The refinement re-fits a line through per-window matches.
    refinement = _windowed_drift_refinement(ref, query, sr, coarse_offset_samples=lag)
    if refinement is not None:
        refined_lag, refined_drift = refinement
        # Trust the refinement if it found ≥3 confident windows. If the refined
        # offset disagrees with chroma by more than 30 s the alignment was unstable
        # — keep chroma's value to avoid a worse failure.
        if abs(refined_lag - lag) <= 30 * sr:
            lag = refined_lag
            drift = refined_drift
            method = method + "+drift"

    if abs(drift - 1.0) > 0.001:  # >0.1% drift
        warning = (warning + "; " if warning else "") + f"Audio drift detected: {drift:.4%}"

    if confidence < 0.3:
        warning = (warning + "; " if warning else "") + "Low sync confidence — preview before sharing"

    offset_ms = (lag / sr) * 1000.0
    return SyncResult(
        offset_ms=offset_ms,
        confidence=confidence,
        drift_ratio=drift,
        method=method,
        warning=warning,
    )
