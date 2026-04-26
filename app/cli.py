"""Admin CLI: add users, prune storage."""
from __future__ import annotations

import asyncio
import getpass
import shutil

import click
from sqlalchemy import select

from app.auth import hash_password
from app.config import settings
from app.db import SessionLocal, init_db
from app.models import Job, User


@click.group()
def cli() -> None:
    pass


@cli.command("add-user")
@click.argument("email")
@click.option("--password", prompt=False, default=None)
def add_user(email: str, password: str | None) -> None:
    """Create a new user. Will prompt for password if not given."""
    if not password:
        password = getpass.getpass("Password: ")
        again = getpass.getpass("Confirm: ")
        if again != password:
            click.echo("Passwords don't match", err=True)
            raise SystemExit(1)
    if len(password) < 8:
        click.echo("Password must be at least 8 chars", err=True)
        raise SystemExit(1)

    asyncio.run(_add_user_async(email, password))
    click.echo(f"Created user {email}")


async def _add_user_async(email: str, password: str) -> None:
    await init_db()
    async with SessionLocal() as s:
        existing = await s.execute(select(User).where(User.email == email.lower().strip()))
        if existing.scalar_one_or_none() is not None:
            click.echo(f"User {email} already exists", err=True)
            raise SystemExit(1)
        user = User(email=email.lower().strip(), password_hash=hash_password(password))
        s.add(user)
        await s.commit()


@cli.command("set-password")
@click.argument("email")
def set_password(email: str) -> None:
    pw1 = getpass.getpass("New password: ")
    pw2 = getpass.getpass("Confirm: ")
    if pw1 != pw2:
        click.echo("Passwords don't match", err=True)
        raise SystemExit(1)
    asyncio.run(_set_password(email, pw1))
    click.echo("Password updated")


async def _set_password(email: str, password: str) -> None:
    await init_db()
    async with SessionLocal() as s:
        res = await s.execute(select(User).where(User.email == email.lower().strip()))
        user = res.scalar_one_or_none()
        if not user:
            click.echo(f"No user {email}", err=True)
            raise SystemExit(1)
        user.password_hash = hash_password(password)
        await s.commit()


@cli.command("list-users")
def list_users() -> None:
    asyncio.run(_list_users())


async def _list_users() -> None:
    await init_db()
    async with SessionLocal() as s:
        res = await s.execute(select(User))
        for u in res.scalars().all():
            click.echo(f"{u.id}\t{u.email}\t{u.created_at.isoformat()}")


@cli.command("cleanup")
def cleanup() -> None:
    """Force-prune tmp dirs."""
    if settings.tmp_dir.exists():
        for child in settings.tmp_dir.iterdir():
            shutil.rmtree(child, ignore_errors=True)
    click.echo("Cleaned tmp dir")


if __name__ == "__main__":
    cli()
