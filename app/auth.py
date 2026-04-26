from __future__ import annotations

from argon2 import PasswordHasher
from argon2.exceptions import VerifyMismatchError
from fastapi import Cookie, Depends, HTTPException, Response, status
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db import get_session
from app.models import User

SESSION_COOKIE = "vasync_session"
_ph = PasswordHasher()
_signer = URLSafeTimedSerializer(settings.secret_key, salt="session")


def hash_password(plain: str) -> str:
    return _ph.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    try:
        return _ph.verify(hashed, plain)
    except VerifyMismatchError:
        return False


def issue_session(response: Response, user_id: str) -> None:
    token = _signer.dumps(user_id)
    response.set_cookie(
        SESSION_COOKIE,
        token,
        max_age=settings.session_max_age_days * 86400,
        httponly=True,
        samesite="lax",
        secure=settings.base_url.startswith("https://"),
    )


def clear_session(response: Response) -> None:
    response.delete_cookie(SESSION_COOKIE)


def _read_session_token(token: str | None) -> str | None:
    if not token:
        return None
    try:
        return _signer.loads(token, max_age=settings.session_max_age_days * 86400)
    except (BadSignature, SignatureExpired):
        return None


async def current_user(
    session: AsyncSession = Depends(get_session),
    cookie: str | None = Cookie(default=None, alias=SESSION_COOKIE),
) -> User:
    user_id = _read_session_token(cookie)
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Not signed in")
    user = await session.get(User, user_id)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unknown user")
    return user


async def authenticate(session: AsyncSession, email: str, password: str) -> User | None:
    res = await session.execute(select(User).where(User.email == email.lower().strip()))
    user = res.scalar_one_or_none()
    if not user or not verify_password(password, user.password_hash):
        return None
    return user


def session_age_seconds() -> int:
    return settings.session_max_age_days * 86400
