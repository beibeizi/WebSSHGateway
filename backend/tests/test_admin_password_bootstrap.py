from __future__ import annotations

from datetime import timedelta

import pytest

from app.core.config import AppConfig, load_config
from app.core.db import Database
from app.models.connection import Connection  # noqa: F401
from app.models.session import SessionRecord  # noqa: F401
from app.models.user import User
from app.services.auth import AuthService
from app.services.bootstrap import ensure_admin_user


def make_config(database_url: str, initial_admin_password: str | None = None) -> AppConfig:
    return AppConfig(
        secret_keys=[b"12345678901234567890123456789012"],
        database_url=database_url,
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
        initial_admin_password=initial_admin_password,
    )


def test_load_config_reads_initial_admin_password(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SECRET_KEY", "12345678901234567890123456789012")
    monkeypatch.setenv("INITIAL_ADMIN_PASSWORD", "RootPass123")

    config = load_config()

    assert config.initial_admin_password == "RootPass123"


def test_ensure_admin_user_uses_configured_initial_password(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    config = make_config(database_url, initial_admin_password="RootPass123")
    auth_service = AuthService(config)

    with database.session() as session:
        created = ensure_admin_user(session, auth_service)

    assert created is True
    with database.session() as session:
        admin = session.query(User).filter(User.username == "admin").one()
        assert auth_service.verify_password("RootPass123", admin.password_hash)
        assert admin.must_change_password is True


def test_ensure_admin_user_requires_initial_password_when_admin_missing(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    config = make_config(database_url, initial_admin_password=None)
    auth_service = AuthService(config)

    with database.session() as session:
        with pytest.raises(RuntimeError, match="INITIAL_ADMIN_PASSWORD"):
            ensure_admin_user(session, auth_service)


def test_ensure_admin_user_does_not_override_existing_admin(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    initial_config = make_config(database_url, initial_admin_password="RootPass123")
    auth_service = AuthService(initial_config)

    with database.session() as session:
        ensure_admin_user(session, auth_service)

    override_config = make_config(database_url, initial_admin_password="AnotherPass123")
    override_auth_service = AuthService(override_config)

    with database.session() as session:
        created = ensure_admin_user(session, override_auth_service)

    assert created is False
    with database.session() as session:
        admin = session.query(User).filter(User.username == "admin").one()
        assert override_auth_service.verify_password("RootPass123", admin.password_hash)
