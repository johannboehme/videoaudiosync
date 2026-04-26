"""Extract reference audio + thumbnails + waveform peaks from a video."""
from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import soundfile as sf

from app.config import settings
from app.pipeline.ffmpeg_util import ffmpeg


async def extract_reference_audio(video_path: Path, out_wav: Path) -> Path:
    out_wav.parent.mkdir(parents=True, exist_ok=True)
    await ffmpeg(
        [
            "-i",
            str(video_path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            str(settings.sample_rate),
            "-f",
            "wav",
            str(out_wav),
        ]
    )
    return out_wav


async def extract_thumbnails_strip(
    video_path: Path, out_png: Path, every_s: float = 2.0, height: int = 80
) -> Path:
    """Single horizontal strip PNG with one thumbnail every `every_s` seconds."""
    out_png.parent.mkdir(parents=True, exist_ok=True)
    fps = max(1.0 / every_s, 0.001)
    await ffmpeg(
        [
            "-i",
            str(video_path),
            "-vf",
            f"fps={fps:.6f},scale=-1:{height},tile=300x1",
            "-frames:v",
            "1",
            str(out_png),
        ]
    )
    return out_png


def compute_waveform_peaks(audio_path: Path, out_json: Path, peaks: int = 1500) -> Path:
    """Read audio file (any format ffmpeg already wrote) and compute min/max peaks for UI."""
    out_json.parent.mkdir(parents=True, exist_ok=True)
    data, sr = sf.read(str(audio_path), always_2d=False)
    if data.ndim > 1:
        data = data.mean(axis=1)
    n = len(data)
    if n == 0:
        out_json.write_text(json.dumps({"sample_rate": sr, "peaks": [], "duration": 0.0}))
        return out_json
    bucket = max(1, n // peaks)
    trimmed = data[: bucket * peaks].reshape(-1, bucket)
    mins = trimmed.min(axis=1)
    maxs = trimmed.max(axis=1)
    pairs = np.stack([mins, maxs], axis=1).astype(np.float32).round(4).tolist()
    out_json.write_text(
        json.dumps(
            {
                "sample_rate": int(sr),
                "duration": float(n) / float(sr),
                "peaks": pairs,
            }
        )
    )
    return out_json
