"""Jobs API: upload, list, get, edit-spec, download, delete, ownership."""
from __future__ import annotations

from tests.conftest import needs_ffmpeg


# ---- Upload ------------------------------------------------------------------


async def test_upload_requires_auth(app_client, tiny_video, studio_audio):
    r = await app_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.mp4", tiny_video.read_bytes(), "video/mp4"),
            "audio": ("audio.wav", studio_audio.read_bytes(), "audio/wav"),
        },
    )
    assert r.status_code == 401


@needs_ffmpeg
async def test_upload_creates_queued_job(authed_client, tiny_video, studio_audio):
    r = await authed_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.mp4", tiny_video.read_bytes(), "video/mp4"),
            "audio": ("audio.wav", studio_audio.read_bytes(), "audio/wav"),
        },
    )
    assert r.status_code == 201
    job = r.json()
    assert job["id"]
    assert job["status"] in {"queued", "analyzing", "syncing", "rendering", "done"}
    assert job["video_filename"] == "video.mp4"
    assert job["audio_filename"] == "audio.wav"
    assert job["bytes_in"] > 0


async def test_upload_rejects_unknown_video_extension(authed_client, studio_audio):
    r = await authed_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.exe", b"\x00\x00", "application/octet-stream"),
            "audio": ("audio.wav", studio_audio.read_bytes(), "audio/wav"),
        },
    )
    assert r.status_code == 400
    assert "extension" in r.json()["detail"].lower()


async def test_upload_rejects_unknown_audio_extension(authed_client, tiny_video):
    r = await authed_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.mp4", tiny_video.read_bytes(), "video/mp4"),
            "audio": ("audio.midi", b"midi", "audio/midi"),
        },
    )
    assert r.status_code == 400


# ---- List + get + ownership --------------------------------------------------


async def test_list_jobs_returns_only_own_jobs(app_client):
    """Two users uploading should not see each other's jobs."""
    from app.auth import hash_password
    from app.db import SessionLocal
    from app.models import Job, User

    async with SessionLocal() as s:
        u1 = User(email="a@x.com", password_hash=hash_password("password1"))
        u2 = User(email="b@x.com", password_hash=hash_password("password2"))
        s.add_all([u1, u2])
        await s.commit()
        s.add(Job(
            user_id=u1.id, video_filename="v.mp4", audio_filename="a.wav",
            video_path="/x/v.mp4", audio_path="/x/a.wav", title="u1-job",
        ))
        s.add(Job(
            user_id=u2.id, video_filename="v.mp4", audio_filename="a.wav",
            video_path="/y/v.mp4", audio_path="/y/a.wav", title="u2-job",
        ))
        await s.commit()

    await app_client.post("/api/auth/login", json={"email": "a@x.com", "password": "password1"})
    r = await app_client.get("/api/jobs")
    assert r.status_code == 200
    titles = [j["title"] for j in r.json()]
    assert "u1-job" in titles
    assert "u2-job" not in titles


async def test_get_other_users_job_returns_404(app_client):
    from app.auth import hash_password
    from app.db import SessionLocal
    from app.models import Job, User

    async with SessionLocal() as s:
        u1 = User(email="a@x.com", password_hash=hash_password("password1"))
        u2 = User(email="b@x.com", password_hash=hash_password("password2"))
        s.add_all([u1, u2])
        await s.commit()
        j = Job(
            user_id=u2.id, video_filename="v.mp4", audio_filename="a.wav",
            video_path="/y/v.mp4", audio_path="/y/a.wav", title="theirs",
        )
        s.add(j)
        await s.commit()
        other_id = j.id

    await app_client.post("/api/auth/login", json={"email": "a@x.com", "password": "password1"})
    r = await app_client.get(f"/api/jobs/{other_id}")
    assert r.status_code == 404


# ---- Delete ------------------------------------------------------------------


async def test_delete_removes_files_and_db_row(authed_client, tmp_path):
    """Deleting a job should remove its uploads/cache/render directories."""
    from app.config import settings
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        res = await s.execute(select(User).where(User.email == "tester@example.com"))
        user = res.scalar_one()
        # create a job with on-disk artifacts
        j = Job(
            user_id=user.id, video_filename="v.mp4", audio_filename="a.wav",
            video_path="x", audio_path="y", title="del-me",
        )
        s.add(j)
        await s.commit()
        job_id = j.id

    # touch dirs
    for sub in ("uploads", "cache", "renders"):
        d = settings.data_dir / sub / job_id
        d.mkdir(parents=True, exist_ok=True)
        (d / "marker").write_text("x")

    r = await authed_client.delete(f"/api/jobs/{job_id}")
    assert r.status_code == 204
    for sub in ("uploads", "cache", "renders"):
        assert not (settings.data_dir / sub / job_id).exists()

    r2 = await authed_client.get(f"/api/jobs/{job_id}")
    assert r2.status_code == 404


# ---- Edit spec ---------------------------------------------------------------


async def test_edit_endpoint_rejects_when_sync_not_done(authed_client):
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (await s.execute(select(User))).scalars().first()
        j = Job(
            user_id=user.id, video_filename="v.mp4", audio_filename="a.wav",
            video_path="x", audio_path="y", title="not-synced", status="queued",
        )
        s.add(j)
        await s.commit()
        job_id = j.id

    r = await authed_client.post(
        f"/api/jobs/{job_id}/edit",
        json={"spec": {"version": 1, "segments": [], "overlays": [], "visualizer": {}}},
    )
    assert r.status_code == 409


# ---- Download / preview ------------------------------------------------------


async def test_download_returns_404_when_no_output(authed_client):
    from app.db import SessionLocal
    from app.models import Job, User
    from sqlalchemy import select

    async with SessionLocal() as s:
        user = (await s.execute(select(User))).scalars().first()
        j = Job(
            user_id=user.id, video_filename="v.mp4", audio_filename="a.wav",
            video_path="x", audio_path="y", status="queued",
        )
        s.add(j)
        await s.commit()
        jid = j.id

    r = await authed_client.get(f"/api/jobs/{jid}/download")
    assert r.status_code == 404
