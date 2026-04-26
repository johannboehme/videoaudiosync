"""report_progress / mark_done semantics: stage, percent, detail, eta — all
make it onto the Job row AND the SSE bus.

Imports are deferred into the test bodies so the per-test `importlib.reload`
in conftest.py applies (otherwise we'd hold references to the pre-reload
SessionLocal pointing at a stale data dir)."""
from __future__ import annotations

import asyncio


async def _make_job(user_email: str = "p@x.com") -> str:
    from app.db import SessionLocal
    from app.models import Job, User

    async with SessionLocal() as s:
        u = User(email=user_email, password_hash="x")
        s.add(u)
        await s.commit()
        j = Job(
            user_id=u.id,
            video_filename="v.mp4",
            audio_filename="a.wav",
            video_path="x",
            audio_path="y",
        )
        s.add(j)
        await s.commit()
        return j.id


async def _drain_event(job_id: str, expected: int = 1) -> list[dict]:
    """Subscribe, then await `expected` events with a tight timeout."""
    from app.events import bus

    q = await bus.subscribe(job_id)
    events: list[dict] = []
    try:
        for _ in range(expected):
            events.append(await asyncio.wait_for(q.get(), timeout=2.0))
    finally:
        await bus.unsubscribe(job_id, q)
    return events


async def test_report_progress_persists_detail_and_eta(app_client):  # noqa: ARG001
    from app.db import SessionLocal
    from app.models import Job
    from app.queue import report_progress

    job_id = await _make_job()
    sub_task = asyncio.create_task(_drain_event(job_id, expected=1))
    await asyncio.sleep(0.05)  # let subscriber attach
    await report_progress(
        job_id, "rendering", 42.5, detail="Encoding output mp4", eta_s=12.0
    )
    events = await sub_task

    assert events == [
        {
            "stage": "rendering",
            "progress": 42.5,
            "status": "rendering",
            "detail": "Encoding output mp4",
            "eta_s": 12.0,
        }
    ]

    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        assert job is not None
        assert job.progress_stage == "rendering"
        assert job.progress_pct == 42.5
        assert job.progress_detail == "Encoding output mp4"
        assert job.progress_eta_s == 12.0


async def test_mark_done_clears_detail_and_eta(app_client):  # noqa: ARG001
    from app.db import SessionLocal
    from app.models import Job
    from app.queue import mark_done, report_progress

    job_id = await _make_job("p2@x.com")
    await report_progress(job_id, "rendering", 80, detail="x", eta_s=5)
    await mark_done(job_id, "/tmp/out.mp4", 1234)
    async with SessionLocal() as s:
        job = await s.get(Job, job_id)
        assert job is not None
        assert job.status == "done"
        assert job.progress_pct == 100.0
        assert job.progress_detail is None
        assert job.progress_eta_s is None


async def test_job_out_exposes_detail_and_eta(authed_client):
    """JobOut Pydantic model surfaces the new fields to the frontend."""
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (
            await s.execute(select(User).where(User.email == "tester@example.com"))
        ).scalar_one()
        j = Job(
            user_id=user.id,
            video_filename="v.mp4",
            audio_filename="a.wav",
            video_path="x",
            audio_path="y",
            title="t",
            progress_stage="rendering",
            progress_pct=33.0,
            progress_detail="Encoding output mp4",
            progress_eta_s=42.0,
        )
        s.add(j)
        await s.commit()
        jid = j.id

    r = await authed_client.get(f"/api/jobs/{jid}")
    assert r.status_code == 200
    body = r.json()
    assert body["progress_detail"] == "Encoding output mp4"
    assert body["progress_eta_s"] == 42.0
