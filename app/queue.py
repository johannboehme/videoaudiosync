"""Single-process job runner: serialized async queue, one job at a time.

A job is just an `async def` that takes a job_id and updates DB + publishes
progress events. No Redis, no workers — fits one container, scales to a
handful of concurrent users.
"""
from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone
from typing import Awaitable, Callable

from app.db import SessionLocal
from app.events import bus
from app.models import Job

log = logging.getLogger(__name__)


JobFunc = Callable[[str], Awaitable[None]]


class JobQueue:
    def __init__(self) -> None:
        self._queue: asyncio.Queue[tuple[str, JobFunc]] = asyncio.Queue()
        self._task: asyncio.Task[None] | None = None

    def start(self) -> None:
        if self._task is None or self._task.done():
            self._task = asyncio.create_task(self._run(), name="job-worker")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None

    async def submit(self, job_id: str, fn: JobFunc) -> None:
        await self._queue.put((job_id, fn))

    async def _run(self) -> None:
        while True:
            job_id, fn = await self._queue.get()
            try:
                await self._mark_started(job_id)
                await fn(job_id)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                log.exception("Job %s failed", job_id)
                await self._mark_failed(job_id, str(exc))
            finally:
                self._queue.task_done()

    async def _mark_started(self, job_id: str) -> None:
        async with SessionLocal() as s:
            job = await s.get(Job, job_id)
            if job is None:
                return
            job.started_at = datetime.now(timezone.utc)
            job.status = "analyzing"
            job.progress_pct = 0.0
            job.progress_stage = "analyzing"
            await s.commit()
        await bus.publish(job_id, {"status": "analyzing", "progress": 0.0, "stage": "analyzing"})

    async def _mark_failed(self, job_id: str, error: str) -> None:
        async with SessionLocal() as s:
            job = await s.get(Job, job_id)
            if job is None:
                return
            job.status = "failed"
            job.error = error[:2000]
            job.finished_at = datetime.now(timezone.utc)
            await s.commit()
        await bus.publish(job_id, {"status": "failed", "error": error})


queue = JobQueue()


async def report_progress(job_id: str, stage: str, pct: float) -> None:
    """Helper for pipeline functions to push progress to DB + SSE."""
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is None:
            return
        job.progress_stage = stage
        job.progress_pct = max(0.0, min(100.0, pct))
        job.status = stage if stage in {"analyzing", "syncing", "rendering"} else job.status
        await s.commit()
    await bus.publish(job_id, {"stage": stage, "progress": pct, "status": stage})


async def mark_done(job_id: str, output_path: str, bytes_out: int) -> None:
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        if job is None:
            return
        job.status = "done"
        job.progress_pct = 100.0
        job.progress_stage = "done"
        job.output_path = output_path
        job.bytes_out = bytes_out
        job.finished_at = datetime.now(timezone.utc)
        await s.commit()
    await bus.publish(job_id, {"status": "done", "progress": 100.0, "stage": "done"})
