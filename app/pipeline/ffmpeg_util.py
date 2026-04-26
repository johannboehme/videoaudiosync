"""Thin async wrappers around ffmpeg / ffprobe."""
from __future__ import annotations

import asyncio
import json
import shlex
from pathlib import Path
from typing import Any


class FFmpegError(RuntimeError):
    pass


async def run(cmd: list[str], *, cwd: Path | None = None) -> tuple[int, str, str]:
    proc = await asyncio.create_subprocess_exec(
        *cmd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        cwd=str(cwd) if cwd else None,
    )
    out_b, err_b = await proc.communicate()
    return proc.returncode or 0, out_b.decode("utf-8", "replace"), err_b.decode("utf-8", "replace")


async def ffmpeg(args: list[str]) -> str:
    code, _out, err = await run(["ffmpeg", "-hide_banner", "-y", *args])
    if code != 0:
        raise FFmpegError(f"ffmpeg failed ({code}): {err[-2000:]}\nargs: {shlex.join(args)}")
    return err  # ffmpeg prints info on stderr


async def ffprobe(path: Path) -> dict[str, Any]:
    code, out, err = await run(
        [
            "ffprobe",
            "-v",
            "error",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            str(path),
        ]
    )
    if code != 0:
        raise FFmpegError(f"ffprobe failed: {err[-2000:]}")
    return json.loads(out)


def video_dims(probe: dict[str, Any]) -> tuple[int, int] | None:
    for s in probe.get("streams", []):
        if s.get("codec_type") == "video":
            try:
                return int(s["width"]), int(s["height"])
            except (KeyError, ValueError):
                return None
    return None


def duration_s(probe: dict[str, Any]) -> float | None:
    fmt = probe.get("format") or {}
    try:
        return float(fmt["duration"])
    except (KeyError, ValueError, TypeError):
        return None
