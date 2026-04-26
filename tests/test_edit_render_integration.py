"""End-to-end edit render: cuts + text overlay + visualizer ride along the audio."""
from __future__ import annotations

import asyncio
import json
import subprocess

from tests.conftest import needs_ffmpeg, needs_libass


async def _wait_for_status(client, job_id, target_states, max_wait_s=120):
    for _ in range(max_wait_s * 2):
        r = await client.get(f"/api/jobs/{job_id}")
        body = r.json()
        if body["status"] in target_states:
            return body
        await asyncio.sleep(0.5)
    return None


@needs_ffmpeg
async def test_edit_render_with_cuts_and_visualizer_only(
    authed_client, tiny_video, studio_audio, tmp_path
):
    """Verify the cut + visualizer + audio re-mux path works end-to-end. Text overlay
    is exercised separately because it depends on ffmpeg being built with libass."""
    r = await authed_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.mp4", tiny_video.read_bytes(), "video/mp4"),
            "audio": ("audio.wav", studio_audio.read_bytes(), "audio/wav"),
        },
    )
    assert r.status_code == 201
    job_id = r.json()["id"]

    initial = await _wait_for_status(authed_client, job_id, {"done", "failed"})
    assert initial is not None and initial["status"] == "done"

    spec = {
        "version": 1,
        "segments": [{"in": 0.0, "out": 1.5}],
        "overlays": [],
        "visualizer": {"type": "showcqt", "position": "bottom", "height_pct": 0.25, "opacity": 0.6},
    }
    r = await authed_client.post(f"/api/jobs/{job_id}/edit", json={"spec": spec})
    assert r.status_code == 200, r.text

    final = await _wait_for_status(authed_client, job_id, {"done", "failed"})
    assert final is not None
    assert final["status"] == "done", f"edit-render failed: {final.get('error')}"

    r = await authed_client.get(f"/api/jobs/{job_id}/download")
    assert r.status_code == 200
    out = tmp_path / "edited.mp4"
    out.write_bytes(r.content)

    probe = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(out)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    streams = probe["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    audio = next(s for s in streams if s["codec_type"] == "audio")
    duration = float(video.get("duration") or audio.get("duration") or 0)
    assert 1.0 < duration < 2.0, f"expected ~1.5s, got {duration}s"


@needs_ffmpeg
@needs_libass
async def test_edit_render_with_text_overlay_and_visualizer(
    authed_client, tiny_video, studio_audio, tmp_path
):
    # Step 1: upload, wait for initial sync to finish
    r = await authed_client.post(
        "/api/jobs/upload",
        files={
            "video": ("video.mp4", tiny_video.read_bytes(), "video/mp4"),
            "audio": ("audio.wav", studio_audio.read_bytes(), "audio/wav"),
        },
    )
    assert r.status_code == 201
    job_id = r.json()["id"]

    initial = await _wait_for_status(authed_client, job_id, {"done", "failed"})
    assert initial is not None and initial["status"] == "done"

    # Step 2: submit edit spec → trim to first 1.5s, add a text overlay, add showcqt visualizer
    spec = {
        "version": 1,
        "segments": [{"in": 0.0, "out": 1.5}],
        "overlays": [
            {
                "type": "text",
                "text": "PROBE",
                "start": 0.2,
                "end": 1.2,
                "preset": "outline",
                "x": 0.5,
                "y": 0.5,
                "animation": "pop",
            }
        ],
        "visualizer": {"type": "showcqt", "position": "bottom", "height_pct": 0.25, "opacity": 0.6},
    }
    r = await authed_client.post(f"/api/jobs/{job_id}/edit", json={"spec": spec})
    assert r.status_code == 200, r.text
    assert r.json()["status"] in {"queued", "rendering"}

    final = await _wait_for_status(authed_client, job_id, {"done", "failed"})
    assert final is not None
    assert final["status"] == "done", f"edit-render failed: {final.get('error')}"
    assert final["edit_spec"]["overlays"][0]["text"] == "PROBE"

    # Step 3: download and probe the rendered video
    r = await authed_client.get(f"/api/jobs/{job_id}/download")
    assert r.status_code == 200
    out = tmp_path / "edited.mp4"
    out.write_bytes(r.content)

    probe = json.loads(
        subprocess.run(
            ["ffprobe", "-v", "error", "-print_format", "json", "-show_streams", str(out)],
            capture_output=True, text=True, check=True,
        ).stdout
    )
    streams = probe["streams"]
    video = next(s for s in streams if s["codec_type"] == "video")
    audio = next(s for s in streams if s["codec_type"] == "audio")
    # Video should be ~1.5s (the kept segment), trimmed audio similar
    duration = float(video.get("duration") or audio.get("duration") or 0)
    assert 1.0 < duration < 2.0, f"expected ~1.5s, got {duration}s"
