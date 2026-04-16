from __future__ import annotations

import io
from contextlib import redirect_stderr, redirect_stdout
from datetime import timedelta

from sqlalchemy import select

from app.core.config import AppConfig
from app.core.db import Database, utc_now
from app.models.connection import Connection  # noqa: F401
from app.models.session import SessionRecord  # noqa: F401
from app.models.user import User
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


def seed_user(database: Database, auth_service: AuthService, username: str, password: str) -> None:
    with database.session() as session:
        session.add(
            User(
                username=username,
                password_hash=auth_service.hash_password(password),
                must_change_password=False,
                failed_login_count=3,
                locked_until=utc_now(),
                last_login=None,
            )
        )


def test_cli_reset_password_updates_user_and_forces_change(tmp_path, monkeypatch) -> None:
    from app import cli

    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    config = make_config(database_url)
    auth_service = AuthService(config)
    seed_user(database, auth_service, "operator", "OldPass123")

    monkeypatch.setenv("SECRET_KEY", "12345678901234567890123456789012")
    monkeypatch.setenv("DATABASE_URL", database_url)

    stdout = io.StringIO()
    stderr = io.StringIO()
    stdin = io.StringIO("FreshPass123\n")
    monkeypatch.setattr("sys.stdin", stdin)

    with redirect_stdout(stdout), redirect_stderr(stderr):
        exit_code = cli.main(["reset-password", "--username", "operator", "--password-stdin"])

    assert exit_code == 0
    with database.session() as session:
        user = session.execute(select(User).where(User.username == "operator")).scalar_one()
        assert auth_service.verify_password("FreshPass123", user.password_hash)
        assert user.must_change_password is True
        assert user.failed_login_count == 0
        assert user.locked_until is None


def test_cli_reset_password_returns_error_when_user_missing(tmp_path, monkeypatch) -> None:
    from app import cli

    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()

    monkeypatch.setenv("SECRET_KEY", "12345678901234567890123456789012")
    monkeypatch.setenv("DATABASE_URL", database_url)
    monkeypatch.setattr("sys.stdin", io.StringIO("FreshPass123\n"))

    stdout = io.StringIO()
    stderr = io.StringIO()

    with redirect_stdout(stdout), redirect_stderr(stderr):
        exit_code = cli.main(["reset-password", "--username", "ghost", "--password-stdin"])

    assert exit_code == 1
    assert "ghost" in stderr.getvalue()
