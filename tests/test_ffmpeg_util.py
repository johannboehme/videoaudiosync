"""Tests for ffmpeg progress-parsing helper."""
from __future__ import annotations

import pytest

from app.pipeline.ffmpeg_util import FFmpegError, ffmpeg_with_progress
from tests.conftest import needs_ffmpeg


@pytest.mark.timeout(30)
@needs_ffmpeg
async def test_ffmpeg_with_progress_calls_callback_monotonically(tiny_video, tmp_path):
    """A re-encode of the 2-s tiny_video should fire `on_progress` repeatedly with
    monotonically growing fractions and finish at (or near) 1.0."""
    out = tmp_path / "out.mp4"
    seen: list[float] = []

    def on_progress(fraction: float, eta_s: float | None) -> None:
        # ffmpeg may overshoot duration slightly on the final tick; clamp for assertion
        seen.append(min(1.0, max(0.0, fraction)))

    await ffmpeg_with_progress(
        [
            "-i",
            str(tiny_video),
            "-c:v",
            "libx264",
            "-preset",
            "ultrafast",
            "-c:a",
            "aac",
            str(out),
        ],
        expected_duration_s=2.0,
        on_progress=on_progress,
    )

    assert out.exists() and out.stat().st_size > 0
    assert len(seen) >= 1, "on_progress was never called"
    # Monotonically non-decreasing
    assert all(b >= a - 1e-6 for a, b in zip(seen, seen[1:])), seen
    # Final reading is at or near completion
    assert seen[-1] >= 0.95, f"expected last fraction >= 0.95, got {seen}"


@pytest.mark.timeout(15)
@needs_ffmpeg
async def test_ffmpeg_with_progress_raises_on_failure(tmp_path):
    """Bad args still raise FFmpegError so callers can surface the failure."""
    seen: list[float] = []
    with pytest.raises(FFmpegError):
        await ffmpeg_with_progress(
            ["-i", str(tmp_path / "does-not-exist.mp4"), str(tmp_path / "out.mp4")],
            expected_duration_s=1.0,
            on_progress=lambda f, e: seen.append(f),
        )
