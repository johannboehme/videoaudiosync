"""Auth API: login, logout, me, session cookie behaviour."""
from __future__ import annotations


async def _create_user(email: str, password: str) -> None:
    from app.auth import hash_password
    from app.db import SessionLocal
    from app.models import User

    async with SessionLocal() as s:
        s.add(User(email=email.lower(), password_hash=hash_password(password)))
        await s.commit()


async def test_login_with_valid_credentials_returns_user(app_client):
    await _create_user("a@b.com", "supersecret")
    r = await app_client.post("/api/auth/login", json={"email": "a@b.com", "password": "supersecret"})
    assert r.status_code == 200
    assert r.json()["email"] == "a@b.com"
    assert "vasync_session" in r.cookies


async def test_login_with_wrong_password_returns_401(app_client):
    await _create_user("a@b.com", "supersecret")
    r = await app_client.post("/api/auth/login", json={"email": "a@b.com", "password": "nope"})
    assert r.status_code == 401


async def test_login_with_unknown_email_returns_401(app_client):
    r = await app_client.post("/api/auth/login", json={"email": "no@one.com", "password": "x"})
    assert r.status_code == 401


async def test_me_returns_current_user_when_authenticated(app_client):
    await _create_user("a@b.com", "supersecret")
    await app_client.post("/api/auth/login", json={"email": "a@b.com", "password": "supersecret"})
    r = await app_client.get("/api/auth/me")
    assert r.status_code == 200
    assert r.json()["email"] == "a@b.com"


async def test_me_returns_401_without_session(app_client):
    r = await app_client.get("/api/auth/me")
    assert r.status_code == 401


async def test_logout_clears_session(app_client):
    await _create_user("a@b.com", "supersecret")
    await app_client.post("/api/auth/login", json={"email": "a@b.com", "password": "supersecret"})
    r = await app_client.post("/api/auth/logout")
    assert r.status_code == 204
    # subsequent /me must be unauthenticated
    r2 = await app_client.get("/api/auth/me")
    assert r2.status_code == 401


async def test_health_endpoint_is_public(app_client):
    r = await app_client.get("/api/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}
