"""Extract pipeline: ffmpeg audio extract, waveform peaks, thumbnail strip."""
from __future__ import annotations

import json

import pytest

from app.pipeline.extract import (
    compute_waveform_peaks,
    extract_reference_audio,
    extract_thumbnails_strip,
)
from tests.conftest import needs_ffmpeg


def test_compute_waveform_peaks_writes_min_max_pairs(tmp_path, studio_audio):
    out = compute_waveform_peaks(studio_audio, tmp_path / "w.json", peaks=200)
    data = json.loads(out.read_text())
    assert data["sample_rate"] == 22050
    assert data["duration"] == pytest.approx(8.0, abs=0.1)
    assert len(data["peaks"]) == 200
    for pair in data["peaks"]:
        assert len(pair) == 2
        assert pair[0] <= pair[1]  # min <= max


def test_compute_waveform_peaks_handles_empty(tmp_path):
    import numpy as np
    import soundfile as sf

    p = tmp_path / "empty.wav"
    sf.write(str(p), np.zeros(0, dtype="float32"), 22050)
    out = compute_waveform_peaks(p, tmp_path / "w.json")
    data = json.loads(out.read_text())
    assert data["peaks"] == []
    assert data["duration"] == 0.0


@needs_ffmpeg
async def test_extract_reference_audio_produces_wav(tmp_path, tiny_video):
    out = await extract_reference_audio(tiny_video, tmp_path / "ref.wav")
    assert out.exists()
    import soundfile as sf

    data, sr = sf.read(str(out))
    assert sr == 22050
    # mono
    assert data.ndim == 1


@needs_ffmpeg
async def test_extract_thumbnails_strip_produces_png(tmp_path, tiny_video):
    out = await extract_thumbnails_strip(tiny_video, tmp_path / "thumbs.png", every_s=0.5, height=40)
    assert out.exists()
    assert out.stat().st_size > 100  # not an empty file
