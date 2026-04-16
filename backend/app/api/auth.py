from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select

from app.api.dependencies import AppState, get_current_user, get_db, get_state
from app.core.db import utc_now
from app.models.user import User
from app.schemas.api import (
    LoginRequest,
    LoginResponse,
    PasswordChangeRequest,
    PasswordResetConfirmRequest,
    PasswordResetRequest,
    PasswordResetRequestResponse,
    StatusResponse,
)


router = APIRouter(prefix="/auth", tags=["auth"])
logger = logging.getLogger(__name__)
PASSWORD_RESET_CLI_MESSAGE = "Web 端不支持重置密码，请联系管理员使用 CLI 重置密码"


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, state: AppState = Depends(get_state), db=Depends(get_db)) -> LoginResponse:
    user = db.execute(select(User).where(User.username == payload.username)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    auth_service = state.auth_service
    if auth_service.is_locked(user):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="账号已锁定，请稍后再试")

    if not auth_service.verify_password(payload.password, user.password_hash):
        auth_service.register_failed_login(user)
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="用户名或密码错误")

    auth_service.clear_login_failures(user)
    token_pair = auth_service.issue_token(user, remember=payload.remember_me)
    return LoginResponse(
        access_token=token_pair.access_token,
        expires_at=token_pair.expires_at,
        force_password_change=user.must_change_password,
    )


@router.post("/change-password")
def change_password(
    payload: PasswordChangeRequest,
    state: AppState = Depends(get_state),
    user: User = Depends(get_current_user),
) -> StatusResponse:
    auth_service = state.auth_service
    if not auth_service.verify_password(payload.current_password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码不正确")

    if payload.new_password != payload.confirm_password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="新密码不一致")

    try:
        auth_service.validate_new_password(user.username, payload.new_password)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    user.password_hash = auth_service.hash_password(payload.new_password)
    user.must_change_password = False
    user.last_login = utc_now()

    return StatusResponse(status="ok")


@router.post("/reset-password/request", response_model=PasswordResetRequestResponse)
def request_password_reset(
    payload: PasswordResetRequest,
    state: AppState = Depends(get_state),
    db=Depends(get_db),
) -> PasswordResetRequestResponse:
    username = payload.username.strip()
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user:
        logger.warning("Password reset requested for user %s, but web reset is disabled; use CLI instead", user.username)
    else:
        logger.warning("Password reset requested for missing user %s; returning generic success to avoid enumeration", username)
    return PasswordResetRequestResponse(status="ok", expires_in_seconds=300)


@router.post("/reset-password/confirm", response_model=StatusResponse)
def confirm_password_reset(
    payload: PasswordResetConfirmRequest,
    state: AppState = Depends(get_state),
    db=Depends(get_db),
) -> StatusResponse:
    username = payload.username.strip()
    user = db.execute(select(User).where(User.username == username)).scalar_one_or_none()
    if user:
        logger.warning("Password reset confirmation requested for user %s, but web reset is disabled; use CLI instead", user.username)
    else:
        logger.warning("Password reset confirmation requested for missing user %s; instructing CLI fallback", username)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=PASSWORD_RESET_CLI_MESSAGE)
