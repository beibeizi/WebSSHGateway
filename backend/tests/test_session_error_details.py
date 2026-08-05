from __future__ import annotations

import asyncio
import json
from datetime import timedelta

import pytest
from fastapi import HTTPException

from app.api.dependencies import AppState
from app.api.sessions import create_session as create_session_endpoint
from app.api.sessions import prepare_session
from app.core.config import AppConfig
from app.core.db import Database
from app.models.connection import Connection
from app.models.session import SessionRecord  # noqa: F401
from app.schemas.api import SessionCreateRequest
from app.models.user import User
from app.services.auth import AuthService
from app.services.crypto import CryptoService
from app.services.session_updates import SessionBroadcaster


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


class FailingSessionManager:
    async def detect_remote_platform(self, _connection, _auth_payload):
        raise ValueError("无效的私钥格式或密码错误")


class CachedPlatformSessionManager:
    def __init__(self) -> None:
        self.detect_calls = 0

    async def detect_remote_platform(self, _connection, _auth_payload):
        self.detect_calls += 1
        raise AssertionError("prepare_session should reuse verified connection platform cache")

    def resolve_keepalive_binary(self, _arch: str, _remote_os: str):
        return None


class CreatedManagedSession:
    session_id = "session-1"
    target_profile = "unknown"
    target_rtt_ms = None
    target_avg_rtt_ms = None
    target_jitter_ms = 0
    target_probe_error_streak = 0
    target_measured_at = None


class StalePlatformSessionManager:
    def __init__(self) -> None:
        self.detect_calls = 0

    async def detect_remote_platform(self, _connection, _auth_payload):
        self.detect_calls += 1
        return "aarch64", "Linux"

    def resolve_keepalive_binary(self, _arch: str, _remote_os: str):
        return None

    def serialize_pty(self, pty):
        return json.dumps({"term": pty.term, "rows": pty.rows, "cols": pty.cols})

    async def create_session(self, **_kwargs):
        return CreatedManagedSession()


def test_prepare_session_returns_target_connection_error_detail(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    config = make_config(database_url)
    auth_service = AuthService(config)
    crypto = CryptoService(config.secret_keys)

    with database.session() as session:
        user = User(
            username="operator",
            password_hash=auth_service.hash_password("RootPass123"),
            must_change_password=False,
        )
        session.add(user)
        session.flush()

        auth_payload = {"password": None, "private_key": "invalid", "key_passphrase": "bad"}
        encrypted = crypto.encrypt(json.dumps(auth_payload))
        connection = Connection(
            user_id=user.id,
            name="broken-key",
            host="127.0.0.1",
            port=22,
            username="root",
            auth_type="private_key",
            auth_data=json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext}),
        )
        session.add(connection)
        session.flush()
        connection_id = connection.id
        user_id = user.id

    state = AppState(
        config=config,
        database=database,
        auth_service=auth_service,
        session_manager=FailingSessionManager(),  # type: ignore[arg-type]
        session_broadcaster=SessionBroadcaster(),
    )

    with database.session() as session:
        user = session.get(User, user_id)
        assert user is not None

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(prepare_session(connection_id, state=state, user=user, db=session))

    assert exc_info.value.status_code == 400
    assert exc_info.value.detail == "无效的私钥格式或密码错误"


def test_prepare_session_reuses_verified_connection_platform_cache(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    config = make_config(database_url)
    auth_service = AuthService(config)
    crypto = CryptoService(config.secret_keys)

    with database.session() as session:
        user = User(
            username="operator",
            password_hash=auth_service.hash_password("RootPass123"),
            must_change_password=False,
        )
        session.add(user)
        session.flush()

        auth_payload = {"password": "secret", "private_key": None, "key_passphrase": None}
        encrypted = crypto.encrypt(json.dumps(auth_payload))
        connection = Connection(
            user_id=user.id,
            name="cached",
            host="127.0.0.1",
            port=22,
            username="root",
            auth_type="password",
            auth_data=json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext}),
            remote_arch="x86_64",
            remote_os="Linux",
            remote_probe_status="verified",
        )
        session.add(connection)
        session.flush()
        connection_id = connection.id
        user_id = user.id

    session_manager = CachedPlatformSessionManager()
    state = AppState(
        config=config,
        database=database,
        auth_service=auth_service,
        session_manager=session_manager,  # type: ignore[arg-type]
        session_broadcaster=SessionBroadcaster(),
    )

    with database.session() as session:
        user = session.get(User, user_id)
        assert user is not None

        response = asyncio.run(prepare_session(connection_id, state=state, user=user, db=session))

    assert response.remote_arch == "x86_64"
    assert response.remote_os == "Linux"
    assert session_manager.detect_calls == 0


def test_create_session_refreshes_stale_connection_platform_cache(tmp_path) -> None:
    database_url = f"sqlite:///{tmp_path / 'app.db'}"
    database = Database(database_url)
    database.create_tables()
    config = make_config(database_url)
    auth_service = AuthService(config)
    crypto = CryptoService(config.secret_keys)

    with database.session() as session:
        user = User(
            username="operator",
            password_hash=auth_service.hash_password("RootPass123"),
            must_change_password=False,
        )
        session.add(user)
        session.flush()

        auth_payload = {"password": "secret", "private_key": None, "key_passphrase": None}
        encrypted = crypto.encrypt(json.dumps(auth_payload))
        connection = Connection(
            user_id=user.id,
            name="stale",
            host="127.0.0.1",
            port=22,
            username="root",
            auth_type="password",
            auth_data=json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext}),
            remote_arch="x86_64",
            remote_os="Linux",
            remote_probe_status="stale",
        )
        session.add(connection)
        session.flush()
        connection_id = connection.id
        user_id = user.id

    session_manager = StalePlatformSessionManager()
    state = AppState(
        config=config,
        database=database,
        auth_service=auth_service,
        session_manager=session_manager,  # type: ignore[arg-type]
        session_broadcaster=SessionBroadcaster(),
    )

    with database.session() as session:
        user = session.get(User, user_id)
        assert user is not None

        response = asyncio.run(
            create_session_endpoint(
                SessionCreateRequest(connection_id=connection_id),
                state=state,
                user=user,
                db=session,
            )
        )

    assert response.remote_arch == "aarch64"
    assert response.remote_os == "Linux"
    assert session_manager.detect_calls == 1
