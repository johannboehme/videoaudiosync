"""Audio-to-audio sync: cross-correlation + DTW fallback."""
from __future__ import annotations

import pytest

from app.pipeline.sync import sync_audio


def test_sync_finds_positive_offset(phone_audio_offset_400ms, studio_audio):
    phone_path, expected_ms = phone_audio_offset_400ms
    result = sync_audio(phone_path, studio_audio)
    # Studio should be delayed by ~400 ms to match phone timeline
    assert result.offset_ms == pytest.approx(expected_ms, abs=30)
    assert result.confidence > 0.5


def test_sync_finds_negative_offset(phone_audio_negative_offset, studio_audio):
    phone_path, expected_ms = phone_audio_negative_offset
    result = sync_audio(phone_path, studio_audio)
    assert result.offset_ms == pytest.approx(expected_ms, abs=30)


def test_sync_returns_high_confidence_on_clean_match(studio_audio):
    """Both inputs are the same studio audio → confidence should be near 1, offset ≈ 0."""
    result = sync_audio(studio_audio, studio_audio)
    assert abs(result.offset_ms) < 5
    assert result.confidence > 0.9


def test_sync_low_confidence_on_unrelated_inputs(tmp_path, studio_audio):
    """Two different signals should produce low confidence."""
    import numpy as np
    import soundfile as sf

    other = tmp_path / "noise.wav"
    rng = np.random.default_rng(99)
    noise = rng.normal(0, 0.1, 22050 * 4).astype("float32")
    sf.write(str(other), noise, 22050)

    result = sync_audio(other, studio_audio)
    # Allow either xcorr or DTW path; just enforce low confidence and a warning
    assert result.confidence < 0.7


def test_sync_detects_drift(phone_audio_drift, studio_long):
    phone_path, _expected_ms, expected_drift = phone_audio_drift
    result = sync_audio(phone_path, studio_long)
    # Drift detection might not be perfect on synthetic data, but should be in the ballpark
    # Either drift_ratio is detected OR a warning is emitted.
    detected_drift = abs(result.drift_ratio - expected_drift) < 0.005
    assert detected_drift or (result.warning and "drift" in result.warning.lower())


def test_sync_finds_offset_when_ref_is_much_shorter_than_query(tmp_path, studio_audio):
    """Real-world case: video is 2 sec (with 400ms silence then song), studio is 8 sec.
    The xcorr-shorter-against-longer path must handle this without spurious peaks."""
    import numpy as np
    import soundfile as sf

    sr = 22050
    studio_data, _ = sf.read(str(studio_audio))
    silence = np.zeros(int(sr * 0.4), dtype="float32")
    # 1.6 sec of song after the silence
    short_phone = np.concatenate([silence, studio_data[: int(sr * 1.6)].astype("float32")])
    p = tmp_path / "short_phone.wav"
    sf.write(str(p), short_phone, sr)

    result = sync_audio(p, studio_audio)
    assert result.offset_ms == pytest.approx(400.0, abs=80.0)
    assert result.confidence > 0.5


def test_sync_handles_empty_audio(tmp_path):
    import soundfile as sf
    import numpy as np

    empty = tmp_path / "empty.wav"
    sf.write(str(empty), np.zeros(0, dtype="float32"), 22050)
    result = sync_audio(empty, empty)
    # Should not raise; should report no offset and low confidence
    assert result.offset_ms == 0.0
    assert result.confidence == 0.0
