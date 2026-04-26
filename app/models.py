from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


def _uuid() -> str:
    return uuid.uuid4().hex


def _now() -> datetime:
    return datetime.now(timezone.utc)


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    # Auto-learn: last manual sync_override_ms the user submitted. Pre-fills the
    # SyncTuner on the next job — Ray-Ban-style devices have a fairly constant
    # capture-time A/V offset, so the prior value is usually a good starting point.
    last_sync_override_ms: Mapped[float | None] = mapped_column(Float, nullable=True)

    jobs: Mapped[list[Job]] = relationship(back_populates="user", cascade="all, delete-orphan")


class Job(Base):
    __tablename__ = "jobs"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)

    # 'queued', 'analyzing', 'syncing', 'rendering', 'done', 'failed'
    status: Mapped[str] = mapped_column(String(32), default="queued", index=True)
    # 'sync' (auto quick render) | 'edit' (full editor render)
    kind: Mapped[str] = mapped_column(String(16), default="sync")

    title: Mapped[str | None] = mapped_column(String(255), nullable=True)

    video_filename: Mapped[str] = mapped_column(String(512))
    audio_filename: Mapped[str] = mapped_column(String(512))
    video_path: Mapped[str] = mapped_column(String(1024))
    audio_path: Mapped[str] = mapped_column(String(1024))

    sync_offset_ms: Mapped[float | None] = mapped_column(Float, nullable=True)
    sync_confidence: Mapped[float | None] = mapped_column(Float, nullable=True)
    sync_drift_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    sync_warning: Mapped[str | None] = mapped_column(String(512), nullable=True)

    duration_s: Mapped[float | None] = mapped_column(Float, nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    fps: Mapped[float | None] = mapped_column(Float, nullable=True)
    bytes_in: Mapped[int] = mapped_column(Integer, default=0)
    bytes_out: Mapped[int] = mapped_column(Integer, default=0)

    edit_spec: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    output_path: Mapped[str | None] = mapped_column(String(1024), nullable=True)
    error: Mapped[str | None] = mapped_column(String(2048), nullable=True)

    progress_pct: Mapped[float] = mapped_column(Float, default=0.0)
    progress_stage: Mapped[str] = mapped_column(String(64), default="queued")
    progress_detail: Mapped[str | None] = mapped_column(String(255), nullable=True)
    progress_eta_s: Mapped[float | None] = mapped_column(Float, nullable=True)

    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now, index=True)
    started_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped[User] = relationship(back_populates="jobs")
