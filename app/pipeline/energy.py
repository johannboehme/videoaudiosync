"""Compute audio energy curves per frequency band for audio-reactive overlays.

Output is a JSON file: { fps, frames, bands: { bass: [...], mids: [...], highs: [...] } }
Values are normalized 0..1 per band.
"""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np


BANDS_HZ = {
    "bass": (20, 200),
    "low_mids": (200, 800),
    "mids": (800, 3000),
    "highs": (3000, 12000),
}


def compute_energy_curves(audio_path: Path, out_json: Path, fps: float = 30.0) -> Path:
    import librosa

    y, sr = librosa.load(str(audio_path), sr=22050, mono=True)
    if y.size == 0:
        out_json.write_text(json.dumps({"fps": fps, "frames": 0, "bands": {}}))
        return out_json

    n_fft = 2048
    hop = max(1, int(round(sr / fps)))
    S = np.abs(librosa.stft(y, n_fft=n_fft, hop_length=hop)) ** 2  # power spectrogram
    freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)

    bands: dict[str, list[float]] = {}
    for name, (lo, hi) in BANDS_HZ.items():
        mask = (freqs >= lo) & (freqs < hi)
        if not mask.any():
            bands[name] = []
            continue
        energy = S[mask].sum(axis=0)
        # log + normalize 0..1
        energy = np.log1p(energy)
        if energy.max() > 0:
            energy = energy / energy.max()
        bands[name] = energy.astype(np.float32).round(4).tolist()

    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(
        json.dumps(
            {
                "fps": float(fps),
                "frames": int(S.shape[1]),
                "bands": bands,
            }
        )
    )
    return out_json


def sample_at(curves: dict, band: str, t_seconds: float) -> float:
    band_data = curves.get("bands", {}).get(band) or []
    if not band_data:
        return 0.0
    fps = float(curves.get("fps") or 30.0)
    idx = int(round(t_seconds * fps))
    if idx < 0:
        return 0.0
    if idx >= len(band_data):
        return float(band_data[-1])
    return float(band_data[idx])
