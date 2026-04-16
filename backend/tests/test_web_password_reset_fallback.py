from __future__ import annotations

from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.api.auth import confirm_password_reset, request_password_reset
from app.core.config import AppConfig
from app.core.db import Database
from app.models.connection import Connection  # noqa: F401
from app.models.session import SessionRecord  # noqa: F401
from app.models.user import User
from app.schemas.api import PasswordResetConfirmRequest, PasswordResetRequest
from app.services.auth import AuthService


def make_config(database_url: str) -> AppConfig:
    return AppConfig(
        secret_keys=[b"12345678901234567890123456789012"],
        database_url=database_url,
        initial_admin_password="RootPass123",
        jwt_issuer="webssh-gateway",
        jwt_access_ttl=timedelta(hours=12),
        jwt_remember_ttl=timedelta(days=7),
        login_lock_minutes=15,
        login_lock_threshold=5,
        session_keepalive_interval=60,
        log_level="INFO",
        port=8080,
        ssh_known_hosts=None,
        ssh_allow_unknown_hosts=False,
        ssh_auto_add_known_hosts=True,
        cors_allow_origins=[],
        keepalive_binary_dir="/tmp/keepalive",
    )


class DummyState:
    def __init__(self, auth_service: AuthService) -> None:
        self.auth_service = auth_service


def seed_user(database: Database, auth_service: AuthService, username: str, password: str) -> None:
    with database.session() as session:
        session.add(
            User(
                username=username,
                password_hash=auth_service.hash_password(password),
                must_change_password=False,
                failed_login_count=0,
                locked_until=None,
                last_login=None,
            )
        )


def test_request_password_reset_returns_uniform_success_for_missing_user(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    state = DummyState(AuthService(make_config(database_url)))

    with database.session() as session:
        response = request_password_reset(
            PasswordResetRequest(username="ghost"),
            state=state,
            db=session,
        )

    assert response.status == "ok"
    assert response.expires_in_seconds == 300


def test_request_password_reset_returns_uniform_success_for_existing_user(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    auth_service = AuthService(make_config(database_url))
    state = DummyState(auth_service)
    seed_user(database, auth_service, "operator", "OldPass123")

    with database.session() as session:
        response = request_password_reset(
            PasswordResetRequest(username="operator"),
            state=state,
            db=session,
        )

    assert response.status == "ok"
    assert response.expires_in_seconds == 300


def test_confirm_password_reset_returns_cli_instruction(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    state = DummyState(AuthService(make_config(database_url)))

    with database.session() as session:
        with pytest.raises(HTTPException) as exc_info:
            confirm_password_reset(
                PasswordResetConfirmRequest(username="ghost", verification_code="123456"),
                state=state,
                db=session,
            )

    assert exc_info.value.status_code == 400
    assert "CLI" in str(exc_info.value.detail)


def test_confirm_password_reset_returns_cli_instruction_for_existing_user(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    auth_service = AuthService(make_config(database_url))
    state = DummyState(auth_service)
    seed_user(database, auth_service, "operator", "OldPass123")

    with database.session() as session:
        with pytest.raises(HTTPException) as exc_info:
            confirm_password_reset(
                PasswordResetConfirmRequest(username="operator", verification_code="123456"),
                state=state,
                db=session,
            )

    assert exc_info.value.status_code == 400
    assert "CLI" in str(exc_info.value.detail)
