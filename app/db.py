from collections.abc import AsyncIterator

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase

from app.config import settings


class Base(DeclarativeBase):
    pass


def _db_url() -> str:
    return f"sqlite+aiosqlite:///{settings.db_path.resolve()}"


engine = create_async_engine(_db_url(), echo=False, future=True)
SessionLocal = async_sessionmaker(engine, expire_on_commit=False, class_=AsyncSession)


# Columns we add lazily to existing SQLite databases (no Alembic, single user).
# The map is read by `_apply_lightweight_migrations` and stays in sync with
# app.models — order matters only for human readability.
_LAZY_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "jobs": [
        ("progress_detail", "VARCHAR(255)"),
        ("progress_eta_s", "FLOAT"),
        ("fps", "FLOAT"),
    ],
    "users": [
        ("last_sync_override_ms", "FLOAT"),
    ],
}


async def _apply_lightweight_migrations() -> None:
    async with engine.begin() as conn:
        for table, cols in _LAZY_COLUMNS.items():
            existing = await conn.execute(text(f"PRAGMA table_info({table})"))
            have = {row[1] for row in existing.all()}
            for name, sql_type in cols:
                if name in have:
                    continue
                await conn.execute(
                    text(f"ALTER TABLE {table} ADD COLUMN {name} {sql_type}")
                )


async def init_db() -> None:
    settings.ensure_dirs()
    # Import to register models on Base.metadata before create_all.
    from app import models  # noqa: F401

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    await _apply_lightweight_migrations()


async def get_session() -> AsyncIterator[AsyncSession]:
    async with SessionLocal() as session:
        yield session
