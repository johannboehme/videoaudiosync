"""Raw media endpoints + auto-learn offset + edit-spec override.

These endpoints exist for the editor's live offset-tuning preview: it needs the
*original* uploaded video (muted, played in <video>) and the *original* studio
audio (decoded to AudioBuffer for Web-Audio scheduling). The synced /preview
endpoint already bakes the algorithm-computed offset in, which is wrong for
live tuning — we need raw assets.
"""
from __future__ import annotations

from pathlib import Path


# ---- /raw-video, /raw-audio --------------------------------------------------


async def _seed_job_with_assets(user_email: str, video_bytes: bytes, audio_bytes: bytes) -> str:
    """Creates a job for the given user and writes real files at video_path/audio_path."""
    from app.config import settings
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (await s.execute(select(User).where(User.email == user_email))).scalar_one()
        j = Job(
            user_id=user.id,
            video_filename="raw.mp4",
            audio_filename="raw.wav",
            video_path="",
            audio_path="",
            title="raw-test",
            status="done",
            sync_offset_ms=120.0,
        )
        s.add(j)
        await s.commit()
        job_id = j.id

        job_dir = settings.uploads_dir / job_id
        job_dir.mkdir(parents=True, exist_ok=True)
        v = job_dir / "video.mp4"
        a = job_dir / "audio.wav"
        v.write_bytes(video_bytes)
        a.write_bytes(audio_bytes)

        j = await s.get(Job, job_id)
        j.video_path = str(v)
        j.audio_path = str(a)
        await s.commit()
    return job_id


async def test_raw_video_requires_auth(app_client):
    r = await app_client.get("/api/jobs/some-id/raw-video")
    assert r.status_code == 401


async def test_raw_video_returns_full_file_when_no_range(authed_client):
    payload = b"\x00\x01" * 5000
    job_id = await _seed_job_with_assets("tester@example.com", payload, b"AUDIO")
    r = await authed_client.get(f"/api/jobs/{job_id}/raw-video")
    assert r.status_code == 200
    assert r.content == payload
    assert r.headers["accept-ranges"] == "bytes"


async def test_raw_video_supports_range_request(authed_client):
    payload = bytes(range(256)) * 40  # 10 240 bytes, deterministic
    job_id = await _seed_job_with_assets("tester@example.com", payload, b"AUDIO")
    r = await authed_client.get(
        f"/api/jobs/{job_id}/raw-video", headers={"Range": "bytes=100-199"}
    )
    assert r.status_code == 206
    assert r.content == payload[100:200]
    assert r.headers["content-range"] == f"bytes 100-199/{len(payload)}"
    assert r.headers["content-length"] == "100"


async def test_raw_video_returns_404_when_path_missing(authed_client):
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (await s.execute(select(User))).scalars().first()
        j = Job(
            user_id=user.id,
            video_filename="v.mp4",
            audio_filename="a.wav",
            video_path="/does/not/exist.mp4",
            audio_path="/does/not/exist.wav",
            title="ghost",
            status="done",
        )
        s.add(j)
        await s.commit()
        jid = j.id

    r = await authed_client.get(f"/api/jobs/{jid}/raw-video")
    assert r.status_code == 404


async def test_raw_video_rejects_other_users_job(app_client):
    from app.auth import hash_password
    from app.db import SessionLocal
    from app.models import User

    async with SessionLocal() as s:
        u1 = User(email="a@x.com", password_hash=hash_password("password1"))
        u2 = User(email="b@x.com", password_hash=hash_password("password2"))
        s.add_all([u1, u2])
        await s.commit()

    job_id = await _seed_job_with_assets("a@x.com", b"VIDEO", b"AUDIO")
    await app_client.post(
        "/api/auth/login", json={"email": "b@x.com", "password": "password2"}
    )
    r = await app_client.get(f"/api/jobs/{job_id}/raw-video")
    assert r.status_code == 404


async def test_raw_audio_supports_range_request(authed_client):
    payload = bytes(range(256)) * 8  # 2 048 bytes
    job_id = await _seed_job_with_assets("tester@example.com", b"VIDEO", payload)
    r = await authed_client.get(
        f"/api/jobs/{job_id}/raw-audio", headers={"Range": "bytes=0-99"}
    )
    assert r.status_code == 206
    assert r.content == payload[0:100]


# ---- Auto-learn last_sync_override_ms ----------------------------------------


async def test_me_returns_last_sync_override_ms(authed_client):
    """Default null when user never submitted an override."""
    r = await authed_client.get("/api/auth/me")
    assert r.status_code == 200
    body = r.json()
    assert "last_sync_override_ms" in body
    assert body["last_sync_override_ms"] is None


async def test_submit_edit_persists_override_to_user_pref(authed_client, tmp_path):
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (await s.execute(select(User))).scalars().first()
        j = Job(
            user_id=user.id,
            video_filename="v.mp4",
            audio_filename="a.wav",
            video_path="x",
            audio_path="y",
            title="t",
            status="done",
            sync_offset_ms=50.0,
        )
        s.add(j)
        await s.commit()
        job_id = j.id

    spec = {
        "version": 1,
        "segments": [],
        "overlays": [],
        "visualizer": None,
        "sync_override_ms": -120.0,
    }
    r = await authed_client.post(f"/api/jobs/{job_id}/edit", json={"spec": spec})
    assert r.status_code == 200

    # /me should now reflect the learned value
    r2 = await authed_client.get("/api/auth/me")
    assert r2.json()["last_sync_override_ms"] == -120.0


async def test_submit_edit_with_zero_override_does_not_overwrite_pref(authed_client):
    """A user who explicitly resets to 0 *should* persist that — overwrite even with 0.
    But submit without sync_override_ms field (== None) should leave pref untouched."""
    from app.auth import hash_password
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (await s.execute(select(User))).scalars().first()
        user.last_sync_override_ms = 75.0
        await s.commit()

        j = Job(
            user_id=user.id,
            video_filename="v.mp4",
            audio_filename="a.wav",
            video_path="x",
            audio_path="y",
            title="t",
            status="done",
            sync_offset_ms=0.0,
        )
        s.add(j)
        await s.commit()
        job_id = j.id

    # No sync_override_ms key at all → leave preference alone
    spec = {"version": 1, "segments": [], "overlays": [], "visualizer": None}
    r = await authed_client.post(f"/api/jobs/{job_id}/edit", json={"spec": spec})
    assert r.status_code == 200

    r2 = await authed_client.get("/api/auth/me")
    assert r2.json()["last_sync_override_ms"] == 75.0


# ---- orchestrator: edit_spec.sync_override_ms is applied ---------------------


async def test_run_edit_job_uses_combined_offset(authed_client, monkeypatch, tmp_path):
    """run_edit_job must add edit_spec.sync_override_ms to job.sync_offset_ms when it
    calls edit_render — the algorithm-computed offset and the user-tuned override
    should compose additively at render time.
    """
    from app.db import SessionLocal
    from app.models import Job, User
    from app.pipeline import orchestrator as orch_mod
    from app.pipeline import render_edit
    from sqlalchemy import select

    captured: dict[str, float] = {}

    async def fake_edit_render(**kwargs):
        captured["offset_ms"] = kwargs["offset_ms"]
        out = kwargs["out_path"]
        Path(out).parent.mkdir(parents=True, exist_ok=True)
        Path(out).write_bytes(b"fake-mp4")
        return Path(out)

    monkeypatch.setattr(render_edit, "edit_render", fake_edit_render)

    async with SessionLocal() as s:
        user = (await s.execute(select(User))).scalars().first()
        j = Job(
            user_id=user.id,
            video_filename="v.mp4",
            audio_filename="a.wav",
            video_path=str(tmp_path / "v.mp4"),
            audio_path=str(tmp_path / "a.wav"),
            title="combined-offset",
            status="queued",
            sync_offset_ms=80.0,
            sync_drift_ratio=1.0,
            edit_spec={
                "version": 1,
                "segments": [],
                "overlays": [],
                "visualizer": None,
                "sync_override_ms": -25.0,
            },
        )
        s.add(j)
        await s.commit()
        job_id = j.id

    await orch_mod.run_edit_job(job_id)

    # algo offset 80 + override -25 = 55
    assert captured["offset_ms"] == 55.0
