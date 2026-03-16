from __future__ import annotations

import asyncio
import json
from typing import Callable

from sqlalchemy import select

from app.core.config import AppConfig, load_config
from app.core.db import Database, utc_now
from app.core.logging import get_logger
from app.models.connection import Connection
from app.models.session import SessionRecord
from app.services.auth import AuthService
from app.services.crypto import CryptoService, EncryptedPayload
from app.services.session_updates import SessionBroadcaster
from app.services.ssh_manager import SessionManager

logger = get_logger(__name__)


def _serialize_session_status(record: SessionRecord) -> str:
    return json.dumps(
        {
            "id": record.id,
            "status": record.status,
            "last_activity": record.last_activity.isoformat(),
            "disconnected_at": record.disconnected_at.isoformat() if record.disconnected_at else None,
            "enhanced_enabled": bool(record.enhanced_enabled),
            "retry_cycle_count": record.retry_cycle_count,
            "auto_retry_count": record.auto_retry_count,
            "allow_auto_retry": bool(record.allow_auto_retry),
        }
    )


def _required_elapsed_seconds_for_next_retry(retry_cycle_count: int) -> int:
    # Retry spacing (seconds): 2, 4, 8, 16, 32
    # retry_cycle_count is the number of attempts already made in current cycle.
    schedule = [2, 4, 8, 16, 32]
    index = min(retry_cycle_count, len(schedule) - 1)
    return schedule[index]


def build_state() -> tuple[
    AppConfig,
    Database,
    AuthService,
    SessionManager,
    SessionBroadcaster,
    Callable[[], None],
    Callable[[], None],
]:
    config = load_config()
    database = Database(config.database_url)
    auth_service = AuthService(config)
    session_broadcaster = SessionBroadcaster()

    def on_session_disconnect(session_id: str) -> None:
        try:
            with database.session() as db:
                record = db.execute(
                    select(SessionRecord).where(SessionRecord.id == session_id)
                ).scalar_one_or_none()
                if record and record.status == "active":
                    record.status = "disconnected"
                    record.last_activity = utc_now()
                    record.disconnected_at = utc_now()
                    record.retry_cycle_count = 0
                    record.allow_auto_retry = bool(record.enhanced_enabled)
                    asyncio.create_task(session_broadcaster.broadcast(record.user_id, _serialize_session_status(record)))
                    logger.info("Session %s marked as disconnected in database", session_id)
        except Exception as e:
            logger.error("Failed to update session %s status: %s", session_id, e)

    session_manager = SessionManager(
        config.session_keepalive_interval,
        session_broadcaster,
        known_hosts=config.ssh_known_hosts,
        allow_unknown_hosts=config.ssh_allow_unknown_hosts,
        auto_add_known_hosts=config.ssh_auto_add_known_hosts,
        on_session_disconnect=on_session_disconnect,
        keepalive_binary_dir=config.keepalive_binary_dir,
    )

    def start_enhanced_retry_worker() -> None:
        async def _worker() -> None:
            while True:
                await asyncio.sleep(5)
                try:
                    with database.session() as db:
                        candidates = db.execute(
                            select(SessionRecord).where(
                                SessionRecord.status == "disconnected",
                                SessionRecord.enhanced_enabled.is_(True),
                                SessionRecord.allow_auto_retry.is_(True),
                                SessionRecord.enhanced_fingerprint.is_not(None),
                                SessionRecord.tmux_binary_path.is_not(None),
                                SessionRecord.retry_cycle_count < 5,
                            )
                        ).scalars().all()

                        now = utc_now()
                        for record in candidates:
                            if not record.disconnected_at:
                                record.disconnected_at = now
                            required_elapsed = _required_elapsed_seconds_for_next_retry(record.retry_cycle_count)
                            elapsed = (now - record.disconnected_at).total_seconds()
                            if elapsed < required_elapsed:
                                continue

                            conn = db.execute(select(Connection).where(Connection.id == record.connection_id)).scalar_one_or_none()
                            if not conn:
                                continue

                            attempt = record.retry_cycle_count + 1
                            try:
                                crypto = CryptoService(config.secret_keys)
                                auth_data = json.loads(conn.auth_data)
                                decrypted = crypto.decrypt(
                                    EncryptedPayload(nonce=auth_data["nonce"], ciphertext=auth_data["ciphertext"])
                                )
                                auth_payload = json.loads(decrypted)
                                pty = session_manager.deserialize_pty(record.pty_info)
                                await session_manager.create_session(
                                    connection=conn,
                                    auth_payload=auth_payload,
                                    pty=pty,
                                    enhanced_enabled=True,
                                    enhanced_fingerprint=record.enhanced_fingerprint,
                                    tmux_binary_path=record.tmux_binary_path,
                                    session_id=record.id,
                                )
                                record.status = "active"
                                record.last_activity = utc_now()
                                record.disconnected_at = None
                                record.retry_cycle_count += 1
                                record.auto_retry_count += 1
                                logger.info("enhanced retry succeeded session_id=%s attempt=%s", record.id, attempt)
                                await session_broadcaster.broadcast(record.user_id, _serialize_session_status(record))
                            except Exception as exc:
                                record.retry_cycle_count += 1
                                record.auto_retry_count += 1
                                record.last_activity = utc_now()
                                logger.warning("enhanced retry failed session_id=%s attempt=%s error=%s", record.id, attempt, exc)
                                await session_broadcaster.broadcast(record.user_id, _serialize_session_status(record))
                except Exception as exc:
                    logger.warning("enhanced retry worker error: %s", exc)

        asyncio.create_task(_worker())

    def start_session_sync_worker() -> None:
        async def _worker() -> None:
            while True:
                await asyncio.sleep(5)
                try:
                    with database.session() as db:
                        records = db.execute(select(SessionRecord)).scalars().all()
                        now = utc_now()
                        for record in records:
                            changed = False

                            # Only enhanced sessions can keep auto-retry capability.
                            if not record.enhanced_enabled and record.allow_auto_retry:
                                record.allow_auto_retry = False
                                changed = True

                            managed = session_manager.get_session(record.id)
                            runtime_active = bool(managed and managed.status == "active" and managed.channel)

                            if record.status == "active":
                                if not runtime_active:
                                    record.status = "disconnected"
                                    record.last_activity = now
                                    record.disconnected_at = now
                                    record.retry_cycle_count = 0
                                    record.allow_auto_retry = bool(record.enhanced_enabled)
                                    changed = True
                                    logger.info(
                                        "session sync marked disconnected session_id=%s enhanced=%s",
                                        record.id,
                                        record.enhanced_enabled,
                                    )
                                elif managed and managed.last_activity > record.last_activity:
                                    record.last_activity = managed.last_activity
                            elif record.status == "disconnected" and runtime_active and managed:
                                record.status = "active"
                                record.last_activity = managed.last_activity
                                record.disconnected_at = None
                                changed = True
                                logger.info("session sync marked active session_id=%s", record.id)

                            if changed:
                                await session_broadcaster.broadcast(record.user_id, _serialize_session_status(record))
                except Exception as exc:
                    logger.warning("session sync worker error: %s", exc)

        asyncio.create_task(_worker())

    return (
        config,
        database,
        auth_service,
        session_manager,
        session_broadcaster,
        start_enhanced_retry_worker,
        start_session_sync_worker,
    )
