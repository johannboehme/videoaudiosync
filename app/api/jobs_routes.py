from __future__ import annotations

import asyncio
import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, Request, UploadFile, status
from fastapi.responses import FileResponse, Response, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import desc, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import current_user
from app.config import settings
from app.db import get_session
from app.events import bus
from app.models import Job, User
from app.pipeline.orchestrator import run_edit_job, run_sync_job
from app.queue import queue

router = APIRouter(prefix="/jobs", tags=["jobs"])

ALLOWED_VIDEO_EXTS = {".mp4", ".mov", ".m4v", ".webm", ".mkv", ".avi"}
ALLOWED_AUDIO_EXTS = {".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".opus"}


class JobOut(BaseModel):
    id: str
    status: str
    kind: str
    title: str | None
    video_filename: str
    audio_filename: str
    sync_offset_ms: float | None
    sync_confidence: float | None
    sync_drift_ratio: float | None
    sync_warning: str | None
    duration_s: float | None
    width: int | None
    height: int | None
    fps: float | None
    progress_pct: float
    progress_stage: str
    progress_detail: str | None
    progress_eta_s: float | None
    error: str | None
    edit_spec: dict[str, Any] | None
    has_output: bool
    bytes_in: int
    bytes_out: int
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


def _job_to_out(job: Job) -> JobOut:
    return JobOut(
        id=job.id,
        status=job.status,
        kind=job.kind,
        title=job.title,
        video_filename=job.video_filename,
        audio_filename=job.audio_filename,
        sync_offset_ms=job.sync_offset_ms,
        sync_confidence=job.sync_confidence,
        sync_drift_ratio=job.sync_drift_ratio,
        sync_warning=job.sync_warning,
        duration_s=job.duration_s,
        width=job.width,
        height=job.height,
        fps=job.fps,
        progress_pct=job.progress_pct,
        progress_stage=job.progress_stage,
        progress_detail=job.progress_detail,
        progress_eta_s=job.progress_eta_s,
        error=job.error,
        edit_spec=job.edit_spec,
        has_output=bool(job.output_path and Path(job.output_path).exists()),
        bytes_in=job.bytes_in,
        bytes_out=job.bytes_out,
        created_at=job.created_at,
        started_at=job.started_at,
        finished_at=job.finished_at,
    )


async def _user_quota_used(session: AsyncSession, user_id: str) -> int:
    res = await session.execute(
        select(func.coalesce(func.sum(Job.bytes_in + Job.bytes_out), 0)).where(
            Job.user_id == user_id
        )
    )
    return int(res.scalar_one() or 0)


def _check_ext(filename: str, allowed: set[str], label: str) -> str:
    ext = Path(filename).suffix.lower()
    if ext not in allowed:
        raise HTTPException(
            status_code=400, detail=f"{label} extension {ext!r} not allowed"
        )
    return ext


@router.post("/upload", response_model=JobOut, status_code=201)
async def upload(
    video: UploadFile = File(...),
    audio: UploadFile = File(...),
    title: str | None = Form(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    if not video.filename or not audio.filename:
        raise HTTPException(status_code=400, detail="Both video and audio files required")

    v_ext = _check_ext(video.filename, ALLOWED_VIDEO_EXTS, "Video")
    a_ext = _check_ext(audio.filename, ALLOWED_AUDIO_EXTS, "Audio")

    # quota pre-check (we don't know exact size before stream; check after)
    used = await _user_quota_used(session, user.id)
    quota_bytes = settings.max_user_quota_gb * 1024 * 1024 * 1024
    if used >= quota_bytes:
        raise HTTPException(status_code=413, detail="Quota exceeded — delete old jobs first")

    job = Job(
        user_id=user.id,
        title=title or Path(video.filename).stem,
        video_filename=video.filename,
        audio_filename=audio.filename,
        video_path="",
        audio_path="",
        kind="sync",
        status="queued",
        progress_stage="queued",
    )
    session.add(job)
    await session.flush()  # need job.id

    job_dir = settings.uploads_dir / job.id
    job_dir.mkdir(parents=True, exist_ok=True)
    video_path = job_dir / f"video{v_ext}"
    audio_path = job_dir / f"audio{a_ext}"

    max_bytes = settings.max_upload_mb * 1024 * 1024
    written = 0
    try:
        for upload_file, dest in ((video, video_path), (audio, audio_path)):
            with dest.open("wb") as f:
                while True:
                    chunk = await upload_file.read(1024 * 1024)
                    if not chunk:
                        break
                    written += len(chunk)
                    if written > max_bytes:
                        raise HTTPException(status_code=413, detail="File too large")
                    f.write(chunk)
    except Exception:
        # cleanup partial
        if video_path.exists():
            video_path.unlink(missing_ok=True)
        if audio_path.exists():
            audio_path.unlink(missing_ok=True)
        await session.delete(job)
        await session.commit()
        raise

    job.video_path = str(video_path)
    job.audio_path = str(audio_path)
    job.bytes_in = written
    await session.commit()
    await session.refresh(job)

    await queue.submit(job.id, run_sync_job)
    return _job_to_out(job)


@router.get("", response_model=list[JobOut])
async def list_jobs(
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
    limit: int = 100,
) -> list[JobOut]:
    res = await session.execute(
        select(Job).where(Job.user_id == user.id).order_by(desc(Job.created_at)).limit(limit)
    )
    return [_job_to_out(j) for j in res.scalars().all()]


async def _get_owned_job(session: AsyncSession, job_id: str, user: User) -> Job:
    job = await session.get(Job, job_id)
    if job is None or job.user_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found")
    return job


@router.get("/{job_id}", response_model=JobOut)
async def get_job(
    job_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    return _job_to_out(await _get_owned_job(session, job_id, user))


@router.delete("/{job_id}", status_code=204)
async def delete_job(
    job_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    job = await _get_owned_job(session, job_id, user)
    for d in (
        settings.uploads_dir / job_id,
        settings.cache_dir / job_id,
        settings.renders_dir / job_id,
        settings.tmp_dir / job_id,
    ):
        if d.exists():
            shutil.rmtree(d, ignore_errors=True)
    await session.delete(job)
    await session.commit()


class EditRequest(BaseModel):
    spec: dict[str, Any]


@router.post("/{job_id}/edit", response_model=JobOut)
async def submit_edit(
    job_id: str,
    body: EditRequest,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> JobOut:
    job = await _get_owned_job(session, job_id, user)
    if job.status in {"analyzing", "syncing", "rendering"}:
        raise HTTPException(status_code=409, detail="Job already running")
    if job.sync_offset_ms is None:
        raise HTTPException(status_code=409, detail="Sync not yet computed")
    job.edit_spec = body.spec
    job.kind = "edit"
    job.status = "queued"
    job.progress_stage = "queued"
    job.progress_pct = 0.0
    # Auto-learn: if the user provided a manual override, remember it on their
    # profile so the next job's SyncTuner pre-fills with this value. Absent
    # field means "no opinion, leave the pref alone."
    if "sync_override_ms" in body.spec:
        try:
            user.last_sync_override_ms = float(body.spec["sync_override_ms"])
        except (TypeError, ValueError):
            pass
    await session.commit()
    await queue.submit(job.id, run_edit_job)
    await session.refresh(job)
    return _job_to_out(job)


@router.get("/{job_id}/download")
async def download_output(
    job_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    job = await _get_owned_job(session, job_id, user)
    if not job.output_path or not Path(job.output_path).exists():
        raise HTTPException(status_code=404, detail="No output yet")
    fname_base = (job.title or "output").replace("/", "_").replace("\\", "_")
    return FileResponse(
        job.output_path,
        media_type="video/mp4",
        filename=f"{fname_base}.mp4",
    )


@router.get("/{job_id}/preview")
async def preview_output(
    job_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Inline-playback variant (for in-app player). Same file, no download header."""
    job = await _get_owned_job(session, job_id, user)
    if not job.output_path or not Path(job.output_path).exists():
        raise HTTPException(status_code=404, detail="No output yet")
    return FileResponse(job.output_path, media_type="video/mp4")


_VIDEO_MIME_BY_EXT = {
    ".mp4": "video/mp4",
    ".m4v": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
}
_AUDIO_MIME_BY_EXT = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".opus": "audio/ogg",
}


def _serve_with_range(
    path: Path,
    range_header: str | None,
    media_type: str,
) -> Response | FileResponse:
    """Serve a static file with HTTP Range support so <video> seek + AudioBuffer
    streaming both work efficiently.

    Why hand-rolled: Starlette's FileResponse only honors the Range header in
    very recent versions and only for some response paths. A small explicit
    handler is more reliable and keeps the test contract obvious.
    """
    if not path.exists() or not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    file_size = path.stat().st_size
    common_headers = {
        "Accept-Ranges": "bytes",
        "Cache-Control": "private, max-age=3600",
    }
    if not range_header:
        return FileResponse(str(path), media_type=media_type, headers=common_headers)

    # parse "bytes=START-END"
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid Range unit")
    spec = range_header[len("bytes="):].strip()
    if "," in spec:  # multi-range — not supported, return full file
        return FileResponse(str(path), media_type=media_type, headers=common_headers)
    try:
        start_s, end_s = spec.split("-", 1)
        if start_s == "":
            # suffix range: last N bytes
            n = int(end_s)
            start = max(0, file_size - n)
            end = file_size - 1
        else:
            start = int(start_s)
            end = int(end_s) if end_s else file_size - 1
    except ValueError:
        raise HTTPException(status_code=416, detail="Invalid Range value")
    if start < 0 or start >= file_size or end < start:
        raise HTTPException(
            status_code=416,
            detail=f"Requested range not satisfiable (file size {file_size})",
            headers={"Content-Range": f"bytes */{file_size}"},
        )
    end = min(end, file_size - 1)
    length = end - start + 1
    with path.open("rb") as f:
        f.seek(start)
        chunk = f.read(length)
    return Response(
        content=chunk,
        status_code=206,
        media_type=media_type,
        headers={
            **common_headers,
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Content-Length": str(length),
        },
    )


@router.get("/{job_id}/raw-video")
async def get_raw_video(
    job_id: str,
    range: str | None = Header(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Original uploaded video, untouched. Editor plays this muted while the
    Web-Audio scheduler drives the studio audio with a user-tuned offset."""
    job = await _get_owned_job(session, job_id, user)
    if not job.video_path:
        raise HTTPException(status_code=404, detail="No raw video")
    p = Path(job.video_path)
    ext = p.suffix.lower()
    media_type = _VIDEO_MIME_BY_EXT.get(ext, "application/octet-stream")
    return _serve_with_range(p, range, media_type)


@router.get("/{job_id}/raw-audio")
async def get_raw_audio(
    job_id: str,
    range: str | None = Header(default=None),
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    """Original studio audio, untouched. Decoded into an AudioBuffer client-side
    for sample-accurate live offset preview."""
    job = await _get_owned_job(session, job_id, user)
    if not job.audio_path:
        raise HTTPException(status_code=404, detail="No raw audio")
    p = Path(job.audio_path)
    ext = p.suffix.lower()
    media_type = _AUDIO_MIME_BY_EXT.get(ext, "application/octet-stream")
    return _serve_with_range(p, range, media_type)


@router.get("/{job_id}/waveform")
async def get_waveform(
    job_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    job = await _get_owned_job(session, job_id, user)
    p = settings.cache_dir / job.id / "waveform.json"
    if not p.exists():
        raise HTTPException(status_code=404, detail="Waveform not ready")
    return FileResponse(p, media_type="application/json")


@router.get("/{job_id}/thumbnails")
async def get_thumbnails(
    job_id: str,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
):
    job = await _get_owned_job(session, job_id, user)
    # New jobs use WebP; older jobs still have PNG. Serve whichever exists.
    cache_dir = settings.cache_dir / job.id
    webp = cache_dir / "thumbs.webp"
    png = cache_dir / "thumbs.png"
    if webp.exists():
        return FileResponse(webp, media_type="image/webp")
    if png.exists():
        return FileResponse(png, media_type="image/png")
    raise HTTPException(status_code=404, detail="Thumbnails not ready")


@router.get("/{job_id}/events")
async def stream_events(
    job_id: str,
    request: Request,
    user: User = Depends(current_user),
    session: AsyncSession = Depends(get_session),
) -> StreamingResponse:
    """SSE: streams job state changes until status becomes done/failed or client disconnects."""
    job = await _get_owned_job(session, job_id, user)
    snapshot = _job_to_out(job).model_dump(mode="json", by_alias=False)

    async def event_gen():
        # First emit current state so reconnects don't miss it
        yield f"event: state\ndata: {json.dumps(snapshot, default=str)}\n\n"
        if job.status in {"done", "failed"}:
            return
        q = await bus.subscribe(job_id)
        try:
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15.0)
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
                    continue
                yield f"event: progress\ndata: {json.dumps(msg, default=str)}\n\n"
                if msg.get("status") in {"done", "failed"}:
                    break
        finally:
            await bus.unsubscribe(job_id, q)

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "X-Accel-Buffering": "no",  # disable proxy buffering for SSE
            "Connection": "keep-alive",
        },
    )
