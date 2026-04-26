from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from sqlalchemy import select

from app.api.auth_routes import router as auth_router
from app.api.jobs_routes import router as jobs_router
from app.config import settings
from app.db import SessionLocal, init_db
from app.models import Job
from app.pipeline.orchestrator import shutdown_pool
from app.queue import queue


log = logging.getLogger("vasync")
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")


async def _cleanup_loop() -> None:
    """Every 6h: prune tmp dirs always; expire uploads/renders >14d old."""
    while True:
        try:
            await _do_cleanup()
        except Exception:  # noqa: BLE001
            log.exception("Cleanup failed")
        await asyncio.sleep(6 * 3600)


async def _do_cleanup() -> None:
    import shutil

    cutoff = datetime.now(timezone.utc) - timedelta(days=14)

    # tmp/* always
    if settings.tmp_dir.exists():
        for child in settings.tmp_dir.iterdir():
            shutil.rmtree(child, ignore_errors=True)

    async with SessionLocal() as s:
        res = await s.execute(select(Job).where(Job.created_at < cutoff))
        for job in res.scalars().all():
            if job.status in {"analyzing", "syncing", "rendering"}:
                continue
            if job.status == "expired":
                continue
            for d in (
                settings.uploads_dir / job.id,
                settings.cache_dir / job.id,
                settings.renders_dir / job.id,
            ):
                if d.exists():
                    shutil.rmtree(d, ignore_errors=True)
            job.video_path = ""
            job.audio_path = ""
            job.output_path = None
            job.status = "expired"
            job.progress_stage = "expired"
        await s.commit()


@asynccontextmanager
async def lifespan(app: FastAPI):  # noqa: ARG001
    await init_db()
    queue.start()
    cleanup_task = asyncio.create_task(_cleanup_loop(), name="cleanup-loop")
    try:
        yield
    finally:
        cleanup_task.cancel()
        await queue.stop()
        shutdown_pool()


app = FastAPI(title="VideoAudioSync", lifespan=lifespan)
app.include_router(auth_router, prefix="/api")
app.include_router(jobs_router, prefix="/api")


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


# ----- static frontend -----
STATIC_DIR = Path(__file__).parent / "static"
INDEX_HTML = STATIC_DIR / "index.html"


if STATIC_DIR.exists():
    app.mount("/assets", StaticFiles(directory=STATIC_DIR / "assets"), name="assets")


@app.get("/{path:path}", include_in_schema=False)
async def spa_fallback(path: str):
    if path.startswith("api/"):
        return JSONResponse({"detail": "Not Found"}, status_code=404)
    candidate = STATIC_DIR / path
    if path and candidate.is_file():
        return FileResponse(candidate)
    if INDEX_HTML.exists():
        return FileResponse(INDEX_HTML)
    return JSONResponse(
        {"detail": "Frontend build missing — run `npm run build` in frontend/."},
        status_code=503,
    )
