"""End-to-end: upload → analyze → sync → quick render → download a real mp4."""
from __future__ import annotations

import asyncio
import json
from pathlib import Path

import pytest

from tests.conftest import needs_ffmpeg


@pytest.mark.timeout(120)
@needs_ffmpeg
async def test_full_pipeline_produces_playable_mp4(authed_client, tiny_video, studio_audio, tmp_path):
    """End-to-end: an upload runs through the full pipeline; output mp4 exists, has the
    studio audio replaced, and is readable by ffprobe."""
    # Start the queue (lifespan isn't fired in ASGI tests by default — but our app uses
    # a lifespan, and httpx ASGITransport does run it). Confirm by submitting a job.
    r = await authed_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.mp4", tiny_video.read_bytes(), "video/mp4"),
            "audio": ("audio.wav", studio_audio.read_bytes(), "audio/wav"),
        },
    )
    assert r.status_code == 201
    job_id = r.json()["id"]

    # Poll until done or failed (max 60s)
    final = None
    for _ in range(120):
        r = await authed_client.get(f"/api/jobs/{job_id}")
        assert r.status_code == 200
        body = r.json()
        if body["status"] in {"done", "failed"}:
            final = body
            break
        await asyncio.sleep(0.5)

    assert final is not None, "Job didn't finish in time"
    assert final["status"] == "done", f"Expected done, got {final['status']}: {final.get('error')}"
    assert final["has_output"] is True
    assert final["sync_offset_ms"] is not None
    # Phone audio fixture was 400ms delayed; sync should pick it up
    assert abs(final["sync_offset_ms"] - 400.0) < 60.0
    assert final["sync_confidence"] > 0.5

    # Download
    r = await authed_client.get(f"/api/jobs/{job_id}/download")
    assert r.status_code == 200
    assert r.headers["content-type"] == "video/mp4"
    assert int(r.headers.get("content-length", 0)) > 1000

    # Save and ffprobe it
    out = tmp_path / "out.mp4"
    out.write_bytes(r.content)

    import subprocess

    res = subprocess.run(
        ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(out)],
        capture_output=True,
        text=True,
        check=True,
    )
    streams = json.loads(res.stdout)["streams"]
    has_video = any(s["codec_type"] == "video" for s in streams)
    has_audio = any(s["codec_type"] == "audio" for s in streams)
    assert has_video, "Output mp4 has no video stream"
    assert has_audio, "Output mp4 has no audio stream"
