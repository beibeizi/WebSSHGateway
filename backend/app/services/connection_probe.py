from __future__ import annotations

import json
import logging
from typing import Any

import asyncssh
from sqlalchemy import select

from app.core.config import AppConfig
from app.core.db import Database, utc_now
from app.models.connection import Connection
from app.services.crypto import CryptoService, EncryptedPayload
from app.services.ssh_manager import SessionManager

logger = logging.getLogger(__name__)

PROBE_UNVERIFIED = "unverified"
PROBE_VERIFYING = "verifying"
PROBE_VERIFIED = "verified"
PROBE_FAILED = "failed"
PROBE_STALE = "stale"


def connection_probe_error_detail(error: Exception) -> str:
    if isinstance(error, asyncssh.PermissionDenied):
        return "SSH 认证失败，请检查用户名、密码或私钥"
    if isinstance(error, asyncssh.HostKeyNotVerifiable):
        return "目标主机密钥无法验证"
    if isinstance(error, TimeoutError):
        return "网络连接超时"
    detail = str(error).strip()
    return detail or "连接目标失败"


def reset_connection_probe(connection: Connection) -> int:
    connection.remote_probe_status = PROBE_VERIFYING
    connection.remote_probe_error = None
    connection.remote_probe_checked_at = None
    connection.remote_arch = None
    connection.remote_os = None
    connection.enhanced_supported = False
    connection.enhanced_probe_error = None
    connection.remote_probe_version = (connection.remote_probe_version or 0) + 1
    return connection.remote_probe_version


def mark_connection_probe_verified(
    connection: Connection,
    remote_arch: str,
    remote_os: str,
    enhanced_supported: bool,
    enhanced_probe_error: str | None = None,
) -> None:
    connection.remote_arch = remote_arch
    connection.remote_os = remote_os
    connection.remote_probe_status = PROBE_VERIFIED
    connection.remote_probe_error = None
    connection.remote_probe_checked_at = utc_now()
    connection.enhanced_supported = enhanced_supported
    connection.enhanced_probe_error = enhanced_probe_error


def mark_connection_probe_failed(connection: Connection, error: Exception | str) -> None:
    connection.remote_probe_status = PROBE_FAILED
    connection.remote_probe_error = error if isinstance(error, str) else connection_probe_error_detail(error)
    connection.remote_probe_checked_at = utc_now()
    connection.enhanced_supported = False
    connection.enhanced_probe_error = None


def mark_connection_probe_stale(connection: Connection, reason: str) -> None:
    connection.remote_probe_status = PROBE_STALE
    connection.remote_probe_error = reason
    connection.remote_probe_checked_at = utc_now()


def has_verified_platform_cache(connection: Connection) -> bool:
    return (
        connection.remote_probe_status == PROBE_VERIFIED
        and bool((connection.remote_arch or "").strip())
        and bool((connection.remote_os or "").strip())
    )


def decrypt_connection_auth(connection: Connection, config: AppConfig) -> dict[str, Any]:
    auth_data = json.loads(connection.auth_data)
    crypto = CryptoService(config.secret_keys)
    decrypted = crypto.decrypt(EncryptedPayload(nonce=auth_data["nonce"], ciphertext=auth_data["ciphertext"]))
    return json.loads(decrypted)


async def run_connection_probe(
    *,
    database: Database,
    config: AppConfig,
    session_manager: SessionManager,
    connection_id: int,
    user_id: int,
    probe_version: int,
) -> None:
    try:
        with database.session() as session:
            connection = session.execute(
                select(Connection).where(Connection.id == connection_id, Connection.user_id == user_id)
            ).scalar_one_or_none()
            if not connection or connection.remote_probe_version != probe_version:
                return
            auth_payload = decrypt_connection_auth(connection, config)
            session.expunge(connection)

        remote_arch, remote_os = await session_manager.detect_remote_platform(connection, auth_payload)
        enhanced_supported = session_manager.resolve_keepalive_binary(remote_arch, remote_os) is not None
    except Exception as error:
        with database.session() as session:
            current = session.execute(
                select(Connection).where(Connection.id == connection_id, Connection.user_id == user_id)
            ).scalar_one_or_none()
            if not current or current.remote_probe_version != probe_version:
                return
            mark_connection_probe_failed(current, error)
        logger.info("connection probe failed connection_id=%s user_id=%s error=%s", connection_id, user_id, error)
        return

    with database.session() as session:
        current = session.execute(
            select(Connection).where(Connection.id == connection_id, Connection.user_id == user_id)
        ).scalar_one_or_none()
        if not current or current.remote_probe_version != probe_version:
            return
        mark_connection_probe_verified(current, remote_arch, remote_os, enhanced_supported)
