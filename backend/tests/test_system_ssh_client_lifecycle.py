from __future__ import annotations

import asyncio
import json
from types import SimpleNamespace

from sqlalchemy import select

from app.api.system import resolve_ssh_client
from app.core.db import Database, utc_now
from app.models.connection import Connection
from app.models.session import SessionRecord
from app.models.user import User  # noqa: F401
from app.services.crypto import CryptoService


class ClosingClient:
    def __init__(self) -> None:
        self.closed = False
        self.waited_closed = False

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        self.waited_closed = True


class ConnectingManager:
    def __init__(self, client: ClosingClient) -> None:
        self.client = client

    async def connect_client(self, connection, auth_payload):
        return self.client


def test_resolve_ssh_client_waits_until_temporary_connection_is_closed(tmp_path) -> None:
    database = Database(f"sqlite:///{tmp_path / 'app.db'}")
    database.create_tables()
    secret_key = b"12345678901234567890123456789012"
    crypto = CryptoService([secret_key])
    encrypted = crypto.encrypt(json.dumps({"password": "secret"}))
    auth_data = json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext})
    now = utc_now()

    with database.session() as db:
        connection = Connection(
            user_id=1,
            name="OpenWrt",
            host="192.0.2.10",
            port=22,
            username="root",
            auth_type="password",
            auth_data=auth_data,
        )
        db.add(connection)
        db.flush()
        db.add(
            SessionRecord(
                id="active-session",
                connection_id=connection.id,
                user_id=1,
                status="active",
                started_at=now,
                last_activity=now,
                pty_info="{}",
                session_order=1,
                enhanced_enabled=False,
                auto_retry_count=0,
                retry_cycle_count=0,
                allow_auto_retry=False,
            )
        )

    client = ClosingClient()
    state = SimpleNamespace(
        config=SimpleNamespace(secret_keys=[secret_key]),
        session_manager=ConnectingManager(client),
    )
    user = SimpleNamespace(id=1)

    with database.session() as db:
        assert db.execute(select(SessionRecord).where(SessionRecord.id == "active-session")).scalar_one()

        async def scenario() -> None:
            async with resolve_ssh_client("active-session", state, user, db) as resolved:
                assert resolved is client

        asyncio.run(scenario())

    assert client.closed is True
    assert client.waited_closed is True
