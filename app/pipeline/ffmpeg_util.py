"""Thin async wrappers around ffmpeg / ffprobe."""
from __future__ import annotations

import asyncio
import json
import shlex
import time
from pathlib import Path
from typing import Any, Awaitable, Callable


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


ProgressCb = Callable[[float, float | None], None] | Callable[[float, float | None], Awaitable[None]]


async def ffmpeg_with_progress(
    args: list[str],
    *,
    expected_duration_s: float,
    on_progress: ProgressCb,
) -> str:
    """Run ffmpeg, streaming `out_time_ms` from `-progress pipe:1` and reporting
    a fraction in [0, 1] plus an ETA in seconds (None if not estimable).

    `expected_duration_s` is the *output* media duration ffmpeg is producing.
    The fraction = out_time_ms / expected_duration_s.

    The same FFmpegError is raised as `ffmpeg()` on non-zero exit.
    """
    full = ["ffmpeg", "-hide_banner", "-nostats", "-y", "-progress", "pipe:1", *args]
    proc = await asyncio.create_subprocess_exec(
        *full,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    started = time.monotonic()
    err_chunks: list[bytes] = []

    async def _drain_stderr() -> None:
        # ffmpeg's normal output goes to stderr; keep it for error messages.
        assert proc.stderr is not None
        while True:
            chunk = await proc.stderr.read(4096)
            if not chunk:
                return
            err_chunks.append(chunk)

    async def _drain_stdout() -> None:
        assert proc.stdout is not None
        last_fraction = -1.0
        while True:
            line_b = await proc.stdout.readline()
            if not line_b:
                return
            line = line_b.decode("utf-8", "replace").strip()
            if "=" not in line:
                continue
            key, _, value = line.partition("=")
            if key != "out_time_ms":
                continue
            try:
                out_us = int(value)
            except ValueError:
                continue
            out_s = max(0.0, out_us / 1_000_000.0)
            fraction = (out_s / expected_duration_s) if expected_duration_s > 0 else 0.0
            # Cap reported fraction so we don't go above 1 mid-encode.
            fraction = min(0.999, max(0.0, fraction))
            if fraction <= last_fraction:
                continue
            last_fraction = fraction
            elapsed = time.monotonic() - started
            eta = (elapsed / fraction - elapsed) if fraction > 0.01 else None
            res = on_progress(fraction, eta)
            if asyncio.iscoroutine(res):
                await res

    stderr_task = asyncio.create_task(_drain_stderr())
    stdout_task = asyncio.create_task(_drain_stdout())
    try:
        rc = await proc.wait()
    finally:
        await asyncio.gather(stderr_task, stdout_task, return_exceptions=True)

    err = b"".join(err_chunks).decode("utf-8", "replace")
    if rc != 0:
        raise FFmpegError(f"ffmpeg failed ({rc}): {err[-2000:]}\nargs: {shlex.join(args)}")
    # Final tick at 1.0 so callers can rely on a complete bar.
    res = on_progress(1.0, 0.0)
    if asyncio.iscoroutine(res):
        await res
    return err


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


def video_fps(probe: dict[str, Any]) -> float | None:
    """Best-effort frames-per-second for the first video stream.

    Prefers `avg_frame_rate` (effective playback fps) over `r_frame_rate`
    (declared base fps) — they only differ for VFR sources, where the
    average is the more useful value for frame-stepping in the editor.
    Returns None if the rate is "0/0" (unknown) or malformed.
    """
    for s in probe.get("streams", []):
        if s.get("codec_type") != "video":
            continue
        for key in ("avg_frame_rate", "r_frame_rate"):
            raw = s.get(key)
            if not raw:
                continue
            try:
                num_s, _, den_s = str(raw).partition("/")
                num = float(num_s)
                den = float(den_s) if den_s else 1.0
                if den <= 0 or num <= 0:
                    continue
                return num / den
            except (ValueError, ZeroDivisionError):
                continue
        return None
    return None
