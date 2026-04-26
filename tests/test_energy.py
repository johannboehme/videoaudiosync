"""Energy curve computation for audio-reactive overlays."""
from __future__ import annotations

import json

import pytest

from app.pipeline.energy import BANDS_HZ, compute_energy_curves, sample_at


def test_compute_energy_curves_writes_all_bands(tmp_path, studio_audio):
    out = compute_energy_curves(studio_audio, tmp_path / "e.json", fps=30.0)
    data = json.loads(out.read_text())
    assert data["fps"] == 30.0
    assert data["frames"] > 0
    for band in BANDS_HZ:
        assert band in data["bands"]
        assert len(data["bands"][band]) == data["frames"]


def test_energy_values_normalized_to_unit_interval(tmp_path, studio_audio):
    out = compute_energy_curves(studio_audio, tmp_path / "e.json")
    data = json.loads(out.read_text())
    for band, values in data["bands"].items():
        assert min(values) >= 0.0, f"{band}: negative value"
        assert max(values) <= 1.0 + 1e-6, f"{band}: value > 1"
        assert max(values) > 0.0, f"{band}: all zero — band is not picking up signal"


def test_bass_band_dominates_for_low_frequency_signal(tmp_path):
    """A pure 100 Hz tone should have strongest energy in the 'bass' band."""
    import numpy as np
    import soundfile as sf

    sr = 22050
    t = np.arange(2 * sr) / sr
    sig = 0.5 * np.sin(2 * np.pi * 100 * t).astype("float32")
    bass_path = tmp_path / "bass.wav"
    sf.write(str(bass_path), sig, sr)

    out = compute_energy_curves(bass_path, tmp_path / "e.json")
    data = json.loads(out.read_text())
    avg_bass = sum(data["bands"]["bass"]) / max(1, len(data["bands"]["bass"]))
    avg_highs = sum(data["bands"]["highs"]) / max(1, len(data["bands"]["highs"]))
    assert avg_bass > avg_highs, f"bass {avg_bass} not > highs {avg_highs}"


def test_compute_energy_handles_empty_audio(tmp_path):
    import numpy as np
    import soundfile as sf

    p = tmp_path / "empty.wav"
    sf.write(str(p), np.zeros(0, dtype="float32"), 22050)
    out = compute_energy_curves(p, tmp_path / "e.json")
    data = json.loads(out.read_text())
    assert data["frames"] == 0


def test_sample_at_returns_value_at_time():
    curves = {
        "fps": 30.0,
        "frames": 60,
        "bands": {"bass": [float(i) / 60 for i in range(60)]},
    }
    # 1 second in (frame 30) → expect 30/60 = 0.5
    assert sample_at(curves, "bass", 1.0) == pytest.approx(0.5, abs=0.02)


def test_sample_at_clamps_past_end():
    curves = {"fps": 30.0, "frames": 10, "bands": {"bass": [0.1] * 10}}
    assert sample_at(curves, "bass", 999.0) == pytest.approx(0.1)


def test_sample_at_returns_zero_for_unknown_band():
    curves = {"fps": 30.0, "frames": 10, "bands": {"bass": [0.5] * 10}}
    assert sample_at(curves, "kazoo", 0.5) == 0.0
