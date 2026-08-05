from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

import pytest
from fastapi import HTTPException
from sqlalchemy import select

from app.api import sessions as sessions_module
from app.api.sessions import retry_enhanced_session
from app.core.db import Database, utc_now
from app.models.connection import Connection
from app.models.session import SessionRecord
from app.models.system_setting import SystemSetting  # noqa: F401
from app.models.user import User  # noqa: F401
from app.services.crypto import CryptoService
from app.services.enhanced_session import EnhancedSessionError
from app.services.types import PtyInfo


class FailingSessionManager:
    def __init__(self) -> None:
        self.attempts = 0

    async def close_session(self, session_id: str) -> None:
        return None

    def deserialize_pty(self, payload: str) -> PtyInfo:
        return PtyInfo(term="xterm-256color", rows=24, cols=80)

    async def create_session(self, **kwargs):
        self.attempts += 1
        raise EnhancedSessionError("目标机器临时目录禁止执行文件，无法启用增强持久化连接")


def seed_retryable_session(database: Database, secret_key: bytes) -> str:
    crypto = CryptoService([secret_key])
    encrypted = crypto.encrypt(json.dumps({"password": "secret"}))
    auth_data = json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext})
    session_id = "enhanced-session"
    with database.session() as db:
        connection = Connection(
            user_id=1,
            name="OpenWrt",
            host="192.0.2.10",
            port=22,
            username="root",
            auth_type="password",
            auth_data=auth_data,
            remote_probe_status="verified",
            remote_probe_version=1,
            remote_arch="aarch64",
            remote_os="Linux",
            enhanced_supported=True,
        )
        db.add(connection)
        db.flush()
        now = utc_now()
        db.add(
            SessionRecord(
                id=session_id,
                connection_id=connection.id,
                user_id=1,
                status="disconnected",
                started_at=now,
                last_activity=now,
                pty_info=json.dumps({"term": "xterm-256color", "rows": 24, "cols": 80}),
                session_order=1,
                enhanced_enabled=True,
                enhanced_fingerprint="kp_test",
                tmux_binary_path="/tmp/tmux.aarch64",
                disconnected_at=now,
                auto_retry_count=0,
                retry_cycle_count=0,
                allow_auto_retry=True,
            )
        )
    return session_id


def test_manual_retry_stops_after_deterministic_enhanced_error(tmp_path: Path, monkeypatch) -> None:
    database = Database(f"sqlite:///{tmp_path / 'app.db'}")
    database.create_tables()
    secret_key = b"12345678901234567890123456789012"
    session_id = seed_retryable_session(database, secret_key)
    manager = FailingSessionManager()
    state = SimpleNamespace(
        config=SimpleNamespace(secret_keys=[secret_key]),
        session_manager=manager,
        session_broadcaster=SimpleNamespace(),
    )
    user = SimpleNamespace(id=1)

    async def no_sleep(delay: float) -> None:
        return None

    monkeypatch.setattr(sessions_module.asyncio, "sleep", no_sleep)

    with pytest.raises(HTTPException, match="临时目录禁止执行"):
        with database.session() as db:
            asyncio.run(retry_enhanced_session(session_id, state=state, user=user, db=db))

    with database.session() as db:
        record = db.execute(select(SessionRecord).where(SessionRecord.id == session_id)).scalar_one()
        assert record.allow_auto_retry is False
        assert record.retry_cycle_count == 1
    assert manager.attempts == 1
