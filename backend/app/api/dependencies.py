from __future__ import annotations

from dataclasses import dataclass
from typing import Callable, Generator

from fastapi import Depends, Header, HTTPException, WebSocket, status
from sqlalchemy import select

from app.core.config import AppConfig
from app.core.db import Database
from app.models.user import User
from app.services.auth import AuthService
from app.services.session_updates import SessionBroadcaster
from app.services.ssh_manager import SessionManager


@dataclass(frozen=True)
class AppState:
    config: AppConfig
    database: Database
    auth_service: AuthService
    session_manager: "SessionManager"
    session_broadcaster: "SessionBroadcaster"
    start_enhanced_retry_worker: Callable[[], None] | None = None
    start_session_sync_worker: Callable[[], None] | None = None


def get_state() -> AppState:
    raise RuntimeError("AppState dependency not configured")


def get_db(state: AppState = Depends(get_state)) -> Generator:
    with state.database.session() as session:
        yield session


def _resolve_user(state: AppState, db: Generator, token: str) -> User:
    try:
        payload = state.auth_service.decode_token(token)
    except Exception:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    user_id = int(payload.get("sub", 0))
    user = db.execute(select(User).where(User.id == user_id)).scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    return user


def get_current_user(
    authorization: str | None = Header(default=None),
    state: AppState = Depends(get_state),
    db: Generator = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")

    token = authorization.removeprefix("Bearer ")
    return _resolve_user(state, db, token)


def get_current_user_from_ws(
    websocket: WebSocket,
    state: AppState,
    db: Generator,
) -> User:
    token = websocket.query_params.get("token")
    if not token:
        token = _token_from_protocol(websocket)
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    return _resolve_user(state, db, token)


def _token_from_protocol(websocket: WebSocket) -> str | None:
    header = websocket.headers.get("sec-websocket-protocol")
    if not header:
        return None
    for part in header.split(","):
        value = part.strip()
        if value.lower().startswith("bearer."):
            return value.split(".", 1)[1]
        if value.lower().startswith("bearer:"):
            return value.split(":", 1)[1]
    return None
