"""Glue: walks a job through extract → sync → render, updating progress."""
from __future__ import annotations

import asyncio
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

from app.config import settings
from app.db import SessionLocal
from app.models import Job
from app.pipeline.extract import (
    compute_waveform_peaks,
    extract_reference_audio,
    extract_thumbnails_strip,
)
from app.pipeline.ffmpeg_util import duration_s, ffprobe, video_dims
from app.pipeline.render_quick import quick_render
from app.pipeline.sync import sync_audio
from app.queue import mark_done, report_progress

# One CPU-bound process at a time on small VPS.
_pool = ProcessPoolExecutor(max_workers=1)


def shutdown_pool() -> None:
    _pool.shutdown(wait=False, cancel_futures=True)


async def _run_cpu(fn, /, *args):
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(_pool, fn, *args)


async def run_sync_job(job_id: str) -> None:
    """Default pipeline: analyze, sync, quick-render."""
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is None:
            return
        video = Path(job.video_path)
        audio = Path(job.audio_path)

    job_cache = settings.cache_dir / job_id
    job_cache.mkdir(parents=True, exist_ok=True)
    job_render = settings.renders_dir / job_id
    job_render.mkdir(parents=True, exist_ok=True)

    # === Stage: analyzing ===
    await report_progress(job_id, "analyzing", 5, detail="Probing video")
    probe = await ffprobe(video)
    dur = duration_s(probe)
    dims = video_dims(probe)
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is not None:
            if dur is not None:
                job.duration_s = dur
            if dims is not None:
                job.width, job.height = dims
            await s.commit()

    await report_progress(job_id, "analyzing", 10, detail="Extracting reference audio")
    ref_wav = job_cache / "ref.wav"
    await extract_reference_audio(video, ref_wav)

    await report_progress(job_id, "analyzing", 25, detail="Computing waveform peaks")
    # waveform + thumbnails (good to have for the editor — done eagerly)
    await _run_cpu(compute_waveform_peaks, audio, job_cache / "waveform.json")

    await report_progress(job_id, "analyzing", 35, detail="Generating thumbnails")
    try:
        await extract_thumbnails_strip(video, job_cache / "thumbs.png")
    except Exception:  # noqa: BLE001
        pass  # thumbs are nice-to-have, never block sync

    # === Stage: syncing ===
    await report_progress(
        job_id,
        "syncing",
        50,
        detail="Aligning audio (chroma + drift refinement)",
    )
    result = await _run_cpu(sync_audio, ref_wav, audio)
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is not None:
            job.sync_offset_ms = result.offset_ms
            job.sync_confidence = result.confidence
            job.sync_drift_ratio = result.drift_ratio
            job.sync_warning = result.warning
            await s.commit()
    await report_progress(job_id, "syncing", 70, detail=f"Sync method: {result.method}")

    # === Stage: rendering ===
    await report_progress(job_id, "rendering", 75, detail="Encoding output mp4")
    out_path = job_render / "output.mp4"

    async def _render_progress(fraction: float, eta: float | None) -> None:
        # quick_render is mostly stream-copy on video — usually finishes in <2 s
        # for a 3-min clip. Map fraction into 75..100 just like the edit-render does.
        pct = 75.0 + 25.0 * max(0.0, min(1.0, fraction))
        await report_progress(
            job_id, "rendering", pct, detail="Encoding output mp4", eta_s=eta
        )

    await quick_render(
        video_path=video,
        studio_audio_path=audio,
        offset_ms=result.offset_ms,
        out_path=out_path,
        drift_ratio=result.drift_ratio,
        expected_duration_s=dur,
        progress_cb=_render_progress,
    )
    size = out_path.stat().st_size if out_path.exists() else 0
    await mark_done(job_id, str(out_path), size)


async def run_edit_job(job_id: str) -> None:
    """Edit-render: applies cuts/overlays/visualizer per edit_spec."""
    from app.pipeline.render_edit import edit_render  # local import to avoid cycle

    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is None:
            return
        video = Path(job.video_path)
        audio = Path(job.audio_path)
        offset_ms = float(job.sync_offset_ms or 0.0)
        drift_ratio = float(job.sync_drift_ratio or 1.0)
        edit_spec = dict(job.edit_spec or {})
        job.started_at = datetime.now(timezone.utc)
        job.error = None
        await s.commit()

    job_cache = settings.cache_dir / job_id
    job_render = settings.renders_dir / job_id
    job_render.mkdir(parents=True, exist_ok=True)

    await report_progress(job_id, "rendering", 10, detail="Building filter graph")
    out_path = job_render / "output.mp4"

    overlay_count = len(edit_spec.get("overlays") or [])
    has_viz = bool(edit_spec.get("visualizer") and edit_spec["visualizer"].get("type"))
    detail_label = (
        "Encoding output mp4 (text overlays + visualizer)"
        if overlay_count and has_viz
        else "Encoding output mp4 (text overlays)"
        if overlay_count
        else "Encoding output mp4 (visualizer)"
        if has_viz
        else "Encoding output mp4"
    )

    def _on_render_progress(pct: float) -> None:
        # render_edit calls this with cumulative pct in [0, 100].
        asyncio.create_task(
            report_progress(job_id, "rendering", pct, detail=detail_label)
        )

    await edit_render(
        video_path=video,
        studio_audio_path=audio,
        offset_ms=offset_ms,
        drift_ratio=drift_ratio,
        edit_spec=edit_spec,
        out_path=out_path,
        cache_dir=job_cache,
        progress_cb=_on_render_progress,
    )
    size = out_path.stat().st_size if out_path.exists() else 0
    await mark_done(job_id, str(out_path), size)
