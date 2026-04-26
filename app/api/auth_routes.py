from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Response, status
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import authenticate, clear_session, current_user, issue_session
from app.db import get_session
from app.models import User

router = APIRouter(prefix="/auth", tags=["auth"])


class LoginIn(BaseModel):
    email: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str


@router.post("/login", response_model=UserOut)
async def login(
    body: LoginIn,
    response: Response,
    session: AsyncSession = Depends(get_session),
) -> UserOut:
    user = await authenticate(session, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")
    issue_session(response, user.id)
    return UserOut(id=user.id, email=user.email)


@router.post("/logout", status_code=204)
async def logout() -> Response:
    response = Response(status_code=204)
    clear_session(response)
    return response


@router.get("/me", response_model=UserOut)
async def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email)
