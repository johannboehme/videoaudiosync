"""Shared fixtures: tmp data dir, synthesized audio, fake phone-recording, tiny videos."""
from __future__ import annotations

import subprocess
from pathlib import Path

import numpy as np
import pytest
import soundfile as sf


@pytest.fixture(scope="session")
def fixtures_dir(tmp_path_factory) -> Path:
    return tmp_path_factory.mktemp("vasync-fixtures")


@pytest.fixture()
def isolated_settings(tmp_path, monkeypatch):
    """Point app.config.settings at a tmp data dir for the test."""
    data = tmp_path / "data"
    monkeypatch.setenv("DATA_DIR", str(data))
    monkeypatch.setenv("SECRET_KEY", "test-secret-key")
    # Reload config so the new env vars apply
    from app import config as cfg

    cfg.settings = cfg.Settings()
    cfg.settings.ensure_dirs()
    return cfg.settings


@pytest.fixture()
async def app_client(isolated_settings):  # noqa: ARG001
    """Fresh ASGI client with isolated DATA_DIR per test.

    httpx's ASGITransport doesn't trigger lifespan events, so we manually init the
    DB and start the queue worker, then stop it on teardown.
    """
    import importlib

    from httpx import ASGITransport, AsyncClient

    from app import auth as auth_mod
    from app import db as db_mod
    from app import events as events_mod
    from app import main as main_mod
    from app import models as models_mod
    from app import queue as queue_mod
    from app.api import auth_routes as auth_routes_mod
    from app.api import jobs_routes as jobs_routes_mod
    from app.pipeline import orchestrator as orch_mod

    importlib.reload(db_mod)
    importlib.reload(models_mod)
    importlib.reload(auth_mod)
    importlib.reload(events_mod)
    importlib.reload(queue_mod)
    importlib.reload(orch_mod)
    importlib.reload(auth_routes_mod)
    importlib.reload(jobs_routes_mod)
    importlib.reload(main_mod)

    await db_mod.init_db()
    queue_mod.queue.start()
    transport = ASGITransport(app=main_mod.app)
    try:
        async with AsyncClient(transport=transport, base_url="http://testserver") as client:
            yield client
    finally:
        await queue_mod.queue.stop()
        orch_mod.shutdown_pool()


@pytest.fixture()
async def authed_client(app_client):
    """Authenticated client. Creates a user, logs in, returns client."""
    from app.auth import hash_password
    from app.db import SessionLocal
    from app.models import User

    async with SessionLocal() as s:
        u = User(email="tester@example.com", password_hash=hash_password("supersecret"))
        s.add(u)
        await s.commit()
    r = await app_client.post(
        "/api/auth/login",
        json={"email": "tester@example.com", "password": "supersecret"},
    )
    assert r.status_code == 200
    return app_client


# ---- Audio fixtures -----------------------------------------------------------

SR = 22050


def _make_song(duration_s: float, *, sr: int = SR, seed: int = 7) -> np.ndarray:
    """Synthesize a 'song-ish' signal with a non-repeating melody, bass, and snare-like
    noise bursts. Deterministic per `seed`. Designed to have enough spectral entropy that
    cross-correlation algorithms can lock onto a unique alignment (avoids the "all
    alignments look similar" failure mode of overly periodic synthetic content)."""
    rng = np.random.default_rng(seed)
    n = int(duration_s * sr)
    t = np.arange(n) / sr

    # Pseudo-random melody: change note every 0.25s, picked from a 7-note scale.
    scale_hz = [220.0, 246.94, 261.63, 293.66, 329.63, 369.99, 415.30]
    note_dur = 0.25
    n_notes = int(np.ceil(duration_s / note_dur))
    note_choices = rng.integers(0, len(scale_hz), n_notes)
    melody = np.zeros(n, dtype=np.float32)
    for i, ch in enumerate(note_choices):
        start = int(i * note_dur * sr)
        end = min(start + int(note_dur * sr), n)
        if end <= start:
            break
        seg = end - start
        f = float(scale_hz[int(ch)])
        env = np.minimum(np.linspace(0, 1, seg) * 8, 1.0) * np.minimum(
            np.linspace(1, 0, seg) * 8 + 1, 1.0
        )
        # add the second harmonic for a slightly brassier tone
        melody[start:end] = 0.35 * env * (
            np.sin(2 * np.pi * f * t[start:end]) + 0.4 * np.sin(2 * np.pi * 2 * f * t[start:end])
        )

    # Steady bass at 80 Hz with slow envelope (acts as harmonic anchor)
    bass = 0.15 * np.sin(2 * np.pi * 80 * t) * (0.6 + 0.4 * np.sin(2 * np.pi * 0.5 * t))

    # Snare-like noise bursts on beats 2 + 4 of a 0.5 s loop (gives transients)
    perc = np.zeros(n, dtype=np.float32)
    for k in range(int(duration_s * 4)):  # quarter-second grid
        i = int(k * 0.25 * sr)
        if k % 2 == 1 and i < n - 256:  # off-beat
            burst = rng.normal(0, 0.4, 256).astype(np.float32) * np.exp(
                -np.linspace(0, 6, 256)
            )
            perc[i : i + 256] += burst

    sig = melody + bass + perc
    sig = sig / max(1.0, float(np.max(np.abs(sig))))
    return sig.astype(np.float32)


def _phone_recording(clean: np.ndarray, sr: int = SR, *, noise_db: float = -20) -> np.ndarray:
    """Simulate the kind of audio a phone mic picks up: lowpass + noise + reverb-ish smear."""
    # crude IIR lowpass via cumulative averaging then decimation reconstruction
    x = clean.copy()
    # 1st-order lowpass at ~3 kHz (alpha = dt / (RC + dt))
    rc = 1.0 / (2 * np.pi * 3000)
    dt = 1.0 / sr
    alpha = dt / (rc + dt)
    y = np.zeros_like(x)
    acc = 0.0
    for i in range(len(x)):
        acc = acc + alpha * (x[i] - acc)
        y[i] = acc
    # micro-reverb: mix in a delayed, attenuated copy
    delay = int(0.04 * sr)
    if delay < len(y):
        y[delay:] += 0.25 * y[:-delay]
    # additive noise
    rms = float(np.sqrt(np.mean(y**2))) or 1e-6
    noise_amp = rms * (10 ** (noise_db / 20))
    y = y + np.random.default_rng(31).normal(0, noise_amp, len(y))
    y = y / max(1.0, float(np.max(np.abs(y))))
    return y.astype(np.float32)


@pytest.fixture(scope="session")
def studio_audio(fixtures_dir) -> Path:
    """A clean 8-second 'song' wav."""
    path = fixtures_dir / "studio.wav"
    if not path.exists():
        sig = _make_song(8.0)
        sf.write(str(path), sig, SR)
    return path


@pytest.fixture(scope="session")
def studio_long(fixtures_dir) -> Path:
    """A 20-second clean song, useful for drift tests."""
    path = fixtures_dir / "studio_long.wav"
    if not path.exists():
        sig = _make_song(20.0)
        sf.write(str(path), sig, SR)
    return path


@pytest.fixture(scope="session")
def phone_audio_offset_400ms(fixtures_dir, studio_audio) -> tuple[Path, float]:
    """Phone-recording version that starts 400 ms LATER than the studio audio.

    Returned offset (positive ms) follows the convention of sync.py: how many
    ms the studio should be DELAYED to match the phone-recorded video timeline.
    """
    path = fixtures_dir / "phone_offset_400ms.wav"
    offset_ms = 400.0
    if not path.exists():
        clean, _ = sf.read(str(studio_audio))
        # phone audio starts at 0 on the video timeline; the song is heard from 400ms in
        pad = int(SR * offset_ms / 1000.0)
        # total length: pad of silence + the song
        sig = np.concatenate([np.zeros(pad, dtype=np.float32), clean.astype(np.float32)])
        sig = _phone_recording(sig)
        sf.write(str(path), sig, SR)
    return path, offset_ms


@pytest.fixture(scope="session")
def phone_audio_negative_offset(fixtures_dir, studio_audio) -> tuple[Path, float]:
    """Phone-recording where recording starts *after* song already started — song heard
    from the very beginning of the video means the studio must be played from -300 ms in.
    Convention: offset_ms < 0 means trim that much from the start of studio."""
    path = fixtures_dir / "phone_neg_offset.wav"
    offset_ms = -300.0
    if not path.exists():
        clean, _ = sf.read(str(studio_audio))
        skip = int(SR * abs(offset_ms) / 1000.0)
        sig = clean[skip:].astype(np.float32)
        sig = _phone_recording(sig)
        sf.write(str(path), sig, SR)
    return path, offset_ms


@pytest.fixture(scope="session")
def phone_audio_drift(fixtures_dir, studio_long) -> tuple[Path, float, float]:
    """Phone audio with a small clock drift (0.3% slower than studio)."""
    path = fixtures_dir / "phone_drift.wav"
    offset_ms = 100.0
    drift_ratio = 1.003  # studio 0.3% faster than phone — phone is "longer"
    if not path.exists():
        import librosa

        clean, _ = sf.read(str(studio_long))
        # stretch clean by 1/drift_ratio so the resulting waveform is "longer" — a phone
        # that recorded slightly slow.
        stretched = librosa.effects.time_stretch(clean.astype(np.float32), rate=1.0 / drift_ratio)
        pad = int(SR * offset_ms / 1000.0)
        sig = np.concatenate([np.zeros(pad, dtype=np.float32), stretched])
        sig = _phone_recording(sig)
        sf.write(str(path), sig, SR)
    return path, offset_ms, drift_ratio


# ---- Video fixtures -----------------------------------------------------------


def _ffmpeg_available() -> bool:
    try:
        subprocess.run(["ffmpeg", "-version"], capture_output=True, check=True)
        return True
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False


def _ffmpeg_filter_available(name: str) -> bool:
    try:
        out = subprocess.run(
            ["ffmpeg", "-hide_banner", "-filters"], capture_output=True, text=True, check=True
        ).stdout
    except (FileNotFoundError, subprocess.CalledProcessError):
        return False
    return any(line.split()[1:2] == [name] for line in out.splitlines() if line.strip())


needs_ffmpeg = pytest.mark.skipif(not _ffmpeg_available(), reason="ffmpeg required")
needs_libass = pytest.mark.skipif(
    not _ffmpeg_filter_available("ass"),
    reason="ffmpeg built without libass (text overlays unavailable)",
)


@pytest.fixture(scope="session")
def tiny_video(fixtures_dir, phone_audio_offset_400ms) -> Path:
    """Build a tiny (~2 sec) 320x240 mp4 whose audio is a phone-style recording."""
    if not _ffmpeg_available():
        pytest.skip("ffmpeg required")
    path = fixtures_dir / "tiny.mp4"
    if not path.exists():
        phone_path, _ = phone_audio_offset_400ms
        # use ffmpeg to make a 2-second color video with the phone audio
        subprocess.run(
            [
                "ffmpeg",
                "-y",
                "-hide_banner",
                "-loglevel",
                "error",
                "-f",
                "lavfi",
                "-i",
                "color=c=red:s=320x240:d=2",
                "-i",
                str(phone_path),
                "-shortest",
                "-c:v",
                "libx264",
                "-preset",
                "ultrafast",
                "-pix_fmt",
                "yuv420p",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                str(path),
            ],
            check=True,
        )
    return path


# Clean event-loop policy for asyncio tests — pytest-asyncio default is fine,
# nothing special needed here.
