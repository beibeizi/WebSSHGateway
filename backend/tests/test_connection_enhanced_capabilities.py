from __future__ import annotations

import asyncio
import json
from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import select

from app.api.sessions import prepare_session
from app.core.db import Database
from app.models.connection import Connection
from app.models.session import SessionRecord  # noqa: F401
from app.models.user import User  # noqa: F401
from app.services.connection_probe import run_connection_probe
from app.services.crypto import CryptoService


class CapabilitySessionManager:
    def __init__(self, result: tuple[str, str, bool, str | None]) -> None:
        self.result = result
        self.calls = 0

    async def detect_remote_capabilities(self, connection, auth_payload):
        self.calls += 1
        return self.result

    def resolve_keepalive_binary(self, arch: str, remote_os: str):
        return Path("/tmp/keeplive.aarch64"), "/tmp/tmux.aarch64"


class LegacyPlatformSessionManager:
    def __init__(self) -> None:
        self.calls = 0

    async def detect_remote_platform(self, connection, auth_payload):
        self.calls += 1
        raise AssertionError("verified platform cache should be reused")

    def resolve_keepalive_binary(self, arch: str, remote_os: str):
        return Path("/tmp/keeplive.aarch64"), "/tmp/tmux.aarch64"


def seed_connection(database: Database, secret_key: bytes) -> int:
    crypto = CryptoService([secret_key])
    encrypted = crypto.encrypt(json.dumps({"password": "secret"}))
    auth_data = json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext})
    with database.session() as db:
        connection = Connection(
            user_id=1,
            name="OpenWrt",
            host="192.0.2.10",
            port=22,
            username="root",
            auth_type="password",
            auth_data=auth_data,
            remote_probe_status="verifying",
            remote_probe_version=1,
            enhanced_supported=False,
        )
        db.add(connection)
        db.flush()
        return connection.id


def test_connection_probe_persists_remote_enhanced_capability_error(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'app.db'}")
    database.create_tables()
    secret_key = b"12345678901234567890123456789012"
    connection_id = seed_connection(database, secret_key)
    manager = CapabilitySessionManager(
        (
            "aarch64",
            "Linux",
            False,
            "目标机器临时目录禁止执行文件，无法启用增强持久化连接",
        )
    )
    config = SimpleNamespace(secret_keys=[secret_key])

    asyncio.run(
        run_connection_probe(
            database=database,
            config=config,
            session_manager=manager,
            connection_id=connection_id,
            user_id=1,
            probe_version=1,
        )
    )

    with database.session() as db:
        connection = db.execute(select(Connection).where(Connection.id == connection_id)).scalar_one()
        assert connection.remote_probe_status == "verified"
        assert connection.remote_arch == "aarch64"
        assert connection.remote_os == "Linux"
        assert connection.enhanced_supported is False
        assert connection.enhanced_probe_error == "目标机器临时目录禁止执行文件，无法启用增强持久化连接"
    assert manager.calls == 1


def test_prepare_session_reuses_cached_enhanced_capability_result(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'app.db'}")
    database.create_tables()
    secret_key = b"12345678901234567890123456789012"
    connection_id = seed_connection(database, secret_key)
    manager = CapabilitySessionManager(("aarch64", "Linux", True, None))
    config = SimpleNamespace(secret_keys=[secret_key], keepalive_binary_dir="/tmp")
    state = SimpleNamespace(config=config, session_manager=manager)
    user = SimpleNamespace(id=1)

    with database.session() as db:
        connection = db.execute(select(Connection).where(Connection.id == connection_id)).scalar_one()
        connection.remote_probe_status = "verified"
        connection.remote_arch = "aarch64"
        connection.remote_os = "Linux"
        connection.enhanced_supported = False
        connection.enhanced_probe_error = "目标机器临时目录禁止执行文件，无法启用增强持久化连接"

    with database.session() as db:
        response = asyncio.run(prepare_session(connection_id, state=state, user=user, db=db))

    assert response.supports_enhanced is False
    assert response.should_prompt_enhance is False
    assert manager.calls == 0


def test_prepare_session_refreshes_legacy_platform_cache_without_capability_result(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'app.db'}")
    database.create_tables()
    secret_key = b"12345678901234567890123456789012"
    connection_id = seed_connection(database, secret_key)
    manager = CapabilitySessionManager(("aarch64", "Linux", True, None))
    config = SimpleNamespace(secret_keys=[secret_key], keepalive_binary_dir="/tmp")
    state = SimpleNamespace(config=config, session_manager=manager)
    user = SimpleNamespace(id=1)

    with database.session() as db:
        connection = db.execute(select(Connection).where(Connection.id == connection_id)).scalar_one()
        connection.remote_probe_status = "verified"
        connection.remote_arch = "aarch64"
        connection.remote_os = "Linux"
        connection.enhanced_supported = False
        connection.enhanced_probe_error = None

    with database.session() as db:
        response = asyncio.run(prepare_session(connection_id, state=state, user=user, db=db))

    assert response.supports_enhanced is True
    assert response.should_prompt_enhance is True
    assert manager.calls == 1


def test_prepare_session_keeps_legacy_manager_compatible_with_verified_platform_cache(tmp_path: Path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'app.db'}")
    database.create_tables()
    secret_key = b"12345678901234567890123456789012"
    connection_id = seed_connection(database, secret_key)
    manager = LegacyPlatformSessionManager()
    config = SimpleNamespace(secret_keys=[secret_key], keepalive_binary_dir="/tmp")
    state = SimpleNamespace(config=config, session_manager=manager)
    user = SimpleNamespace(id=1)

    with database.session() as db:
        connection = db.execute(select(Connection).where(Connection.id == connection_id)).scalar_one()
        connection.remote_probe_status = "verified"
        connection.remote_arch = "aarch64"
        connection.remote_os = "Linux"
        connection.enhanced_supported = False
        connection.enhanced_probe_error = None

    with database.session() as db:
        response = asyncio.run(prepare_session(connection_id, state=state, user=user, db=db))

    assert response.supports_enhanced is True
    assert response.should_prompt_enhance is True
    assert manager.calls == 0
