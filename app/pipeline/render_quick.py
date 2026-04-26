"""Quick-sync render: replace video's audio with studio audio at the computed offset."""
from __future__ import annotations

from pathlib import Path
from typing import Awaitable, Callable

from app.pipeline.ffmpeg_util import ffmpeg, ffmpeg_with_progress


async def quick_render(
    video_path: Path,
    studio_audio_path: Path,
    offset_ms: float,
    out_path: Path,
    drift_ratio: float = 1.0,
    *,
    expected_duration_s: float | None = None,
    progress_cb: Callable[[float, float | None], Awaitable[None] | None] | None = None,
) -> Path:
    """Replace video audio with studio audio aligned by offset_ms.

    Sign convention (matches sync.py):
      - offset_ms > 0: delay studio relative to video (studio starts LATER) → pad audio with silence
      - offset_ms < 0: trim studio start (studio plays from |offset| ms in)

    drift_ratio: if not 1.0, apply atempo to compensate. atempo accepts 0.5..2.0 per pass.
    """
    out_path.parent.mkdir(parents=True, exist_ok=True)

    audio_filters: list[str] = []
    if abs(drift_ratio - 1.0) > 0.001:
        # chain atempo if needed (single pass typically fine)
        target = drift_ratio
        chain = []
        while target < 0.5:
            chain.append("atempo=0.5")
            target /= 0.5
        while target > 2.0:
            chain.append("atempo=2.0")
            target /= 2.0
        chain.append(f"atempo={target:.6f}")
        audio_filters.extend(chain)

    if offset_ms >= 0:
        delay = int(round(offset_ms))
        audio_filters.append(f"adelay={delay}|{delay}:all=1")
        ss_args: list[str] = []
    else:
        # Trim from start of studio
        ss_args = ["-ss", f"{abs(offset_ms) / 1000.0:.3f}"]

    af = ",".join(audio_filters) if audio_filters else "anull"

    args = [
        "-i",
        str(video_path),
        *ss_args,
        "-i",
        str(studio_audio_path),
        "-map",
        "0:v:0",
        "-map",
        "1:a:0",
        "-c:v",
        "copy",
        "-af",
        af,
        "-c:a",
        "aac",
        "-b:a",
        "192k",
        "-shortest",
        "-movflags",
        "+faststart",
        str(out_path),
    ]
    if progress_cb is not None and expected_duration_s and expected_duration_s > 0:
        await ffmpeg_with_progress(
            args,
            expected_duration_s=expected_duration_s,
            on_progress=progress_cb,
        )
    else:
        await ffmpeg(args)
    return out_path
