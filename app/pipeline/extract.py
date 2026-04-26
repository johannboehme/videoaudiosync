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


def adaptive_thumb_interval(duration_s: float) -> float:
    """How often (seconds) to sample a thumbnail given a video's total length.

    Editor density: short videos benefit from dense thumbs (every 0.5s) for
    fine scrubbing; longer videos would explode disk usage at that density,
    so we step back to 1s and 2s. The cap at 2s matches the previous
    hardcoded behaviour, so longer files stay backwards compatible.
    """
    if duration_s <= 60:
        return 0.5
    if duration_s <= 600:
        return 1.0
    return 2.0


async def extract_thumbnails_strip(
    video_path: Path,
    out_path: Path,
    every_s: float = 1.0,
    height: int = 80,
    duration_s: float | None = None,
) -> Path:
    """Single horizontal strip with one thumbnail every `every_s` seconds.

    Output format is inferred from `out_path` extension. WebP is preferred
    over PNG for the editor (3-5× smaller for the same visual quality).
    If `duration_s` is provided, `every_s` is overridden by the adaptive
    interval — callers that don't have duration info can pass it in if they
    want to force a value.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)
    if duration_s is not None:
        every_s = adaptive_thumb_interval(duration_s)
    fps = max(1.0 / every_s, 0.001)
    # Number of tiles — overshoot slightly so we don't crop the last second.
    cols = int(max(1, (duration_s or every_s * 300) / every_s)) + 2
    args = [
        "-i",
        str(video_path),
        "-vf",
        f"fps={fps:.6f},scale=-1:{height},tile={cols}x1",
        "-frames:v",
        "1",
    ]
    if out_path.suffix.lower() in (".webp",):
        # libwebp benefits from explicit quality; default 75 is a good balance
        args += ["-c:v", "libwebp", "-quality", "75"]
    args.append(str(out_path))
    await ffmpeg(args)
    return out_path


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
