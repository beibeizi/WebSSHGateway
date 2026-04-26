from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid

import asyncssh
from fastapi import APIRouter, Depends, HTTPException, WebSocket, WebSocketDisconnect, status
from pydantic import BaseModel
from sqlalchemy import select, func

from app.api.dependencies import AppState, get_current_user, get_current_user_from_ws, get_db, get_state
from app.core.db import utc_now
from app.core.i18n import resolve_websocket_language, translate_message
from app.core.logging import get_logger
from app.models.connection import Connection
from app.models.session import SessionRecord
from app.schemas.api import (
    SessionCreateRequest,
    SessionOrderUpdateRequest,
    SessionNoteUpdateRequest,
    SessionResponse,
    SessionStatusResponse,
    TerminalMessage,
)
from app.services.crypto import CryptoService, EncryptedPayload
from app.services.session_updates import SessionBroadcaster
from app.services.ssh_manager import ManagedSession, SessionManager
from app.services.system_settings import load_runtime_system_settings, resolve_retry_delay_seconds
from app.services.types import PtyInfo

logger = get_logger(__name__)


_DA_RESPONSE_SEQUENCES: tuple[str, ...] = tuple(
    sorted(
        {
            # 标准序列（带 ESC 前缀）
            "\x1b[?1;2c",        # xterm primary DA response
            "\x1b[>0;276;0c",    # xterm secondary DA response
            "\x1b[?6c",          # linux primary DA response
            "\x1b[>85;95;0c",    # rxvt secondary DA response
            "\x1b[>83;40003;0c", # screen secondary DA response
            # 兼容前缀缺失/被截断的变体（重连阶段实测会出现）
            "[?1;2c",
            "[>0;276;0c",
            "[?6c",
            "[>85;95;0c",
            "[>83;40003;0c",
            "?1;2c",
            ">0;276;0c",
            "?6c",
            ">85;95;0c",
            ">83;40003;0c",
            "0;276;0c",
            "85;95;0c",
            "83;40003;0c",
        },
        key=len,
        reverse=True,
    )
)
_DA_MAX_SEQUENCE_LEN = max(len(sequence) for sequence in _DA_RESPONSE_SEQUENCES)
_INITIAL_DA_SUPPRESS_SECONDS = 12.0
_TARGET_CONNECTION_EXCEPTIONS = (ValueError, OSError, TimeoutError, asyncssh.Error)


def _strip_da_response_sequences(data: str) -> str:
    """Strip known DA response sequences from payload and return remaining content."""
    if not data:
        return data
    index = 0
    remaining_parts: list[str] = []
    data_len = len(data)
    while index < data_len:
        matched = False
        for sequence in _DA_RESPONSE_SEQUENCES:
            if data.startswith(sequence, index):
                index += len(sequence)
                matched = True
                break
        if not matched:
            remaining_parts.append(data[index])
            index += 1
    return "".join(remaining_parts)


def _split_possible_da_prefix_suffix(data: str) -> tuple[str, str]:
    """Split payload into (safe_forward, pending_suffix) for fragmented DA response handling."""
    if not data:
        return "", ""
    max_tail = min(len(data), _DA_MAX_SEQUENCE_LEN - 1)
    for tail_len in range(max_tail, 0, -1):
        suffix = data[-tail_len:]
        if any(sequence.startswith(suffix) for sequence in _DA_RESPONSE_SEQUENCES):
            return data[:-tail_len], suffix
    return data, ""


class SessionPrepareResponse(BaseModel):
    connection_id: int
    remote_arch: str
    remote_os: str
    supports_enhanced: bool
    first_time_enhance_available: bool
    should_prompt_enhance: bool


def _target_connection_error_detail(error: Exception) -> str:
    if isinstance(error, asyncssh.PermissionDenied):
        return "SSH 认证失败，请检查用户名、密码或私钥"
    detail = str(error).strip()
    return detail or "连接目标失败"


def _raise_target_connection_error(error: Exception, operation: str) -> None:
    detail = _target_connection_error_detail(error)
    logger.warning("%s failed: %s", operation, detail)
    raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail) from error


def _serialize_session_status(record: SessionRecord) -> str:
    return json.dumps(
        {
            "id": record.id,
            "status": record.status,
            "last_activity": record.last_activity.isoformat(),
            "disconnected_at": record.disconnected_at.isoformat() if record.disconnected_at else None,
            "auto_retry_count": record.auto_retry_count,
            "retry_cycle_count": record.retry_cycle_count,
            "allow_auto_retry": bool(record.allow_auto_retry),
            "enhanced_enabled": bool(record.enhanced_enabled),
        }
    )


def _build_session_response(
    record: SessionRecord,
    conn: Connection,
    managed_session: ManagedSession | None = None,
) -> SessionResponse:
    target_profile = managed_session.target_profile if managed_session else "unknown"
    target_rtt_ms = managed_session.target_rtt_ms if managed_session else None
    target_avg_rtt_ms = managed_session.target_avg_rtt_ms if managed_session else None
    target_jitter_ms = managed_session.target_jitter_ms if managed_session else 0
    target_probe_error_streak = managed_session.target_probe_error_streak if managed_session else 0
    target_measured_at = managed_session.target_measured_at if managed_session else None
    return SessionResponse(
        id=record.id,
        connection_id=record.connection_id,
        status=record.status,
        started_at=record.started_at,
        last_activity=record.last_activity,
        host=conn.host,
        username=conn.username,
        name=conn.name,
        note=record.note,
        session_order=record.session_order or 0,
        enhanced_enabled=bool(record.enhanced_enabled),
        remote_arch=conn.remote_arch,
        remote_os=conn.remote_os,
        disconnected_at=record.disconnected_at,
        auto_retry_count=record.auto_retry_count,
        retry_cycle_count=record.retry_cycle_count,
        allow_auto_retry=bool(record.allow_auto_retry),
        target_profile=target_profile,
        target_rtt_ms=target_rtt_ms,
        target_avg_rtt_ms=target_avg_rtt_ms,
        target_jitter_ms=target_jitter_ms,
        target_probe_error_streak=target_probe_error_streak,
        target_measured_at=target_measured_at,
    )


router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.get("", response_model=list[SessionResponse])
def list_sessions(
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> list[SessionResponse]:
    records = db.execute(
        select(SessionRecord)
        .where(SessionRecord.user_id == user.id)
        .order_by(SessionRecord.session_order.asc(), SessionRecord.started_at.asc())
    ).scalars().all()
    responses = []
    for record in records:
        conn = db.execute(select(Connection).where(Connection.id == record.connection_id)).scalar_one_or_none()
        if not conn:
            continue
        managed_session = state.session_manager.get_session(record.id)
        responses.append(_build_session_response(record, conn, managed_session))
    return responses


@router.get("/{session_id}", response_model=SessionResponse)
def get_session(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SessionResponse:
    record = db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    conn = db.execute(select(Connection).where(Connection.id == record.connection_id)).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")
    managed_session = state.session_manager.get_session(record.id)
    return _build_session_response(record, conn, managed_session)


@router.post("/prepare/{connection_id}", response_model=SessionPrepareResponse)
async def prepare_session(
    connection_id: int,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SessionPrepareResponse:
    conn = db.execute(
        select(Connection).where(Connection.id == connection_id, Connection.user_id == user.id)
    ).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    crypto = CryptoService(state.config.secret_keys)
    auth_data = json.loads(conn.auth_data)
    decrypted = crypto.decrypt(EncryptedPayload(nonce=auth_data["nonce"], ciphertext=auth_data["ciphertext"]))
    auth_payload = json.loads(decrypted)

    session_manager: SessionManager = state.session_manager
    try:
        remote_arch, remote_os = await session_manager.detect_remote_platform(conn, auth_payload)
    except _TARGET_CONNECTION_EXCEPTIONS as error:
        _raise_target_connection_error(error, "prepare_session target detection")
    conn.remote_arch = remote_arch
    conn.remote_os = remote_os

    supports_enhanced = session_manager.resolve_keepalive_binary(remote_arch, remote_os) is not None
    has_existing_enhanced = db.execute(
        select(SessionRecord.id).where(
            SessionRecord.connection_id == conn.id,
            SessionRecord.user_id == user.id,
            SessionRecord.enhanced_enabled.is_(True),
            SessionRecord.enhanced_fingerprint.is_not(None),
            SessionRecord.tmux_binary_path.is_not(None),
        )
    ).first() is not None
    first_time_enhance_available = supports_enhanced and not conn.enhance_prompt_shown and not has_existing_enhanced
    should_prompt_enhance = supports_enhanced

    logger.info(
        "prepare_session decision conn_id=%s user_id=%s arch=%s os=%s supports_enhanced=%s prompt_shown=%s has_existing=%s first_time=%s should_prompt=%s keepalive_dir=%s",
        conn.id,
        user.id,
        remote_arch,
        remote_os,
        supports_enhanced,
        conn.enhance_prompt_shown,
        has_existing_enhanced,
        first_time_enhance_available,
        should_prompt_enhance,
        state.config.keepalive_binary_dir,
    )

    return SessionPrepareResponse(
        connection_id=conn.id,
        remote_arch=remote_arch,
        remote_os=remote_os,
        supports_enhanced=supports_enhanced,
        first_time_enhance_available=first_time_enhance_available,
        should_prompt_enhance=should_prompt_enhance,
    )


@router.post("", response_model=SessionResponse)
async def create_session(
    payload: SessionCreateRequest,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SessionResponse:
    conn = db.execute(
        select(Connection).where(Connection.id == payload.connection_id, Connection.user_id == user.id)
    ).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    crypto = CryptoService(state.config.secret_keys)
    auth_data = json.loads(conn.auth_data)
    decrypted = crypto.decrypt(EncryptedPayload(nonce=auth_data["nonce"], ciphertext=auth_data["ciphertext"]))
    auth_payload = json.loads(decrypted)
    pty = PtyInfo(term=payload.term, rows=payload.rows, cols=payload.cols)

    session_manager: SessionManager = state.session_manager
    broadcaster: SessionBroadcaster = state.session_broadcaster

    logger.info(
        "create_session request conn_id=%s user_id=%s enable_enhanced_persistence=%s remote_arch_cached=%s remote_os_cached=%s",
        conn.id,
        user.id,
        payload.enable_enhanced_persistence,
        conn.remote_arch,
        conn.remote_os,
    )

    remote_arch = (conn.remote_arch or "").strip()
    remote_os = (conn.remote_os or "").strip()
    if not remote_arch or not remote_os:
        try:
            detected_arch, detected_os = await session_manager.detect_remote_platform(conn, auth_payload)
        except _TARGET_CONNECTION_EXCEPTIONS as error:
            _raise_target_connection_error(error, "create_session target detection")
        conn.remote_arch = detected_arch
        conn.remote_os = detected_os
        remote_arch = detected_arch
        remote_os = detected_os

    binary_match = session_manager.resolve_keepalive_binary(remote_arch, remote_os) if payload.enable_enhanced_persistence else None
    enable_enhanced = False
    enhanced_fingerprint: str | None = None
    tmux_binary_path: str | None = None

    if payload.enable_enhanced_persistence:
        if not binary_match:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前目标机器不支持增强持久化连接")
        enhanced_fingerprint = f"kp_{conn.id}_{user.id}_{uuid.uuid4().hex}"
        tmux_binary_path = binary_match[1]
        enable_enhanced = True

    if conn.enhance_prompt_shown is False and payload.enable_enhanced_persistence and binary_match is not None:
        conn.enhance_prompt_shown = True

    max_order = db.execute(
        select(func.max(SessionRecord.session_order)).where(SessionRecord.user_id == user.id)
    ).scalar_one()
    next_order = (max_order or 0) + 1

    try:
        managed = await session_manager.create_session(
            connection=conn,
            auth_payload=auth_payload,
            pty=pty,
            enhanced_enabled=enable_enhanced,
            enhanced_fingerprint=enhanced_fingerprint,
            tmux_binary_path=tmux_binary_path,
        )
    except _TARGET_CONNECTION_EXCEPTIONS as error:
        _raise_target_connection_error(error, "create_session ssh connection")

    record = SessionRecord(
        id=managed.session_id,
        connection_id=conn.id,
        user_id=user.id,
        status="active",
        started_at=utc_now(),
        last_activity=utc_now(),
        pty_info=session_manager.serialize_pty(pty),
        note=None,
        session_order=next_order,
        enhanced_enabled=enable_enhanced,
        enhanced_fingerprint=enhanced_fingerprint,
        tmux_binary_path=tmux_binary_path,
        disconnected_at=None,
        auto_retry_count=0,
        retry_cycle_count=0,
        allow_auto_retry=bool(enable_enhanced),
    )
    db.add(record)

    response = _build_session_response(record, conn, managed)
    await broadcaster.broadcast(user.id, response.model_dump_json())
    return response


@router.post("/{session_id}/retry", response_model=SessionResponse)
async def retry_enhanced_session(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SessionResponse:
    record = db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")
    if not record.enhanced_enabled or not record.enhanced_fingerprint or not record.tmux_binary_path:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="该会话未开启增强持久化连接")
    if record.status == "active":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="会话当前在线，无需重试")
    if not record.allow_auto_retry:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前会话已禁用重试")

    conn = db.execute(select(Connection).where(Connection.id == record.connection_id)).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    crypto = CryptoService(state.config.secret_keys)
    auth_data = json.loads(conn.auth_data)
    decrypted = crypto.decrypt(EncryptedPayload(nonce=auth_data["nonce"], ciphertext=auth_data["ciphertext"]))
    auth_payload = json.loads(decrypted)

    session_manager: SessionManager = state.session_manager
    broadcaster: SessionBroadcaster = state.session_broadcaster
    pty = session_manager.deserialize_pty(record.pty_info)
    settings = load_runtime_system_settings(db)

    last_error: Exception | None = None
    for attempt in range(1, settings.enhanced_retry_max_attempts + 1):
        try:
            await session_manager.close_session(session_id)
            managed = await session_manager.create_session(
                connection=conn,
                auth_payload=auth_payload,
                pty=pty,
                enhanced_enabled=True,
                enhanced_fingerprint=record.enhanced_fingerprint,
                tmux_binary_path=record.tmux_binary_path,
                session_id=record.id,
            )
            record.id = managed.session_id
            record.status = "active"
            record.last_activity = utc_now()
            record.disconnected_at = None
            record.auto_retry_count += 1
            record.retry_cycle_count = attempt
            record.allow_auto_retry = True
            response = _build_session_response(record, conn, managed)
            await broadcaster.broadcast(user.id, response.model_dump_json())
            return response
        except Exception as exc:
            last_error = exc
            if attempt < settings.enhanced_retry_max_attempts:
                await asyncio.sleep(resolve_retry_delay_seconds(attempt - 1, settings.enhanced_retry_schedule_seconds))

    raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(last_error) if last_error else "重试失败")


@router.post("/{session_id}/disconnect")
async def disconnect_session(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    record = db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session_manager: SessionManager = state.session_manager
    broadcaster: SessionBroadcaster = state.session_broadcaster
    if record.status == "active":
        record.status = "disconnected"
        record.last_activity = utc_now()
        record.disconnected_at = utc_now()
        record.allow_auto_retry = False
        record.retry_cycle_count = 0
        await session_manager.close_session(session_id, terminate_enhanced=True)
    else:
        record.allow_auto_retry = False
        record.retry_cycle_count = 0

    await broadcaster.broadcast(user.id, _serialize_session_status(record))
    return {"status": "ok"}


@router.delete("/{session_id}")
async def delete_session(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    record = db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    session_manager: SessionManager = state.session_manager
    broadcaster: SessionBroadcaster = state.session_broadcaster
    if record.status == "active":
        record.status = "disconnected"
        record.last_activity = utc_now()
        record.disconnected_at = utc_now()
        record.allow_auto_retry = False
        record.retry_cycle_count = 0
        await session_manager.close_session(session_id, terminate_enhanced=True)
        await broadcaster.broadcast(user.id, _serialize_session_status(record))

    db.delete(record)
    await broadcaster.broadcast(
        user.id,
        SessionStatusResponse(id=record.id, status="deleted", last_activity=utc_now()).model_dump_json(),
    )
    return {"status": "ok"}


@router.patch("/{session_id}/note", response_model=SessionResponse)
async def update_session_note(
    session_id: str,
    payload: SessionNoteUpdateRequest,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SessionResponse:
    record = db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Session not found")

    record.note = payload.note
    record.last_activity = utc_now()

    conn = db.execute(select(Connection).where(Connection.id == record.connection_id)).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    managed_session = state.session_manager.get_session(record.id)
    response = _build_session_response(record, conn, managed_session)
    broadcaster: SessionBroadcaster = state.session_broadcaster
    await broadcaster.broadcast(user.id, response.model_dump_json())
    return response


@router.patch("/order")
def update_session_order(
    payload: SessionOrderUpdateRequest,
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    records = db.execute(select(SessionRecord).where(SessionRecord.user_id == user.id)).scalars().all()
    if not records:
        return {"status": "ok"}

    record_map = {record.id: record for record in records}
    ordered_ids: list[str] = []
    seen: set[str] = set()

    for session_id in payload.ordered_ids:
        if session_id in seen:
            continue
        if session_id not in record_map:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Session not found")
        ordered_ids.append(session_id)
        seen.add(session_id)

    existing_sorted = sorted(
        records,
        key=lambda record: (
            1 if (record.session_order is None or record.session_order <= 0) else 0,
            record.session_order or 0,
            record.started_at,
        ),
    )
    for record in existing_sorted:
        if record.id in seen:
            continue
        ordered_ids.append(record.id)
        seen.add(record.id)

    for index, session_id in enumerate(ordered_ids, start=1):
        record_map[session_id].session_order = index

    return {"status": "ok"}


@router.websocket("/ws/terminal/{session_id}")
async def terminal_socket(
    websocket: WebSocket,
    session_id: str,
    state: AppState = Depends(get_state),
    db=Depends(get_db),
) -> None:
    await websocket.accept()
    language = resolve_websocket_language(websocket)
    try:
        user = get_current_user_from_ws(websocket, state, db)
        record = db.execute(select(SessionRecord).where(SessionRecord.id == session_id)).scalar_one_or_none()
        if not record or record.user_id != user.id:
            await websocket.close(code=1008)
            return

        session_manager: SessionManager = state.session_manager
        session = session_manager.get_session(session_id)
        if not session or session.status != "active" or not session.channel:
            if record.status == "active":
                record.status = "disconnected"
                record.last_activity = utc_now()
                record.disconnected_at = utc_now()
                record.retry_cycle_count = 0
                record.allow_auto_retry = bool(record.enhanced_enabled)
                broadcaster: SessionBroadcaster = state.session_broadcaster
                await broadcaster.broadcast(user.id, _serialize_session_status(record))
            await websocket.send_text(translate_message("Session not active", language))
            await websocket.close(code=1008)
            return

        bound_session = session
        session.websockets.add(websocket)
        try:
            replay_outputs = session.buffer.dump()
            # DA 响应（例如 \x1b[>0;276;0c）在重连阶段可能被误注入到远端 shell。
            # 抑制窗口对每次 WS 建连都开启，不再依赖是否有回放缓冲数据。
            suppress_initial_da_responses = True
            for output in replay_outputs:
                await websocket.send_text(output.data)
            suppress_da_deadline = (
                time.monotonic() + _INITIAL_DA_SUPPRESS_SECONDS if suppress_initial_da_responses else 0.0
            )
            da_fragment_buffer = ""

            while True:
                message = await websocket.receive_text()
                payload = TerminalMessage.model_validate_json(message)
                active_session = session_manager.get_session(session_id)
                if not active_session or active_session.status != "active" or not active_session.channel:
                    await websocket.send_text(translate_message("Session not active", language))
                    await websocket.close(code=1008)
                    return
                if payload.type == "input" and payload.data is not None:
                    data_to_send = payload.data
                    if (
                        suppress_initial_da_responses
                        and time.monotonic() <= suppress_da_deadline
                    ):
                        merged = da_fragment_buffer + data_to_send
                        stripped = _strip_da_response_sequences(merged)
                        safe_forward, pending_suffix = _split_possible_da_prefix_suffix(stripped)
                        if safe_forward != merged or pending_suffix:
                            logger.info(
                                "ws-input-da-suppressed session_id=%s user_id=%s raw_bytes=%s forwarded_bytes=%s pending_bytes=%s",
                                session_id,
                                user.id,
                                len(merged),
                                len(safe_forward),
                                len(pending_suffix),
                            )
                        da_fragment_buffer = pending_suffix
                        data_to_send = safe_forward
                    elif da_fragment_buffer:
                        # 抑制窗口结束后释放残留分片，避免用户真实输入被长期缓存。
                        data_to_send = da_fragment_buffer + data_to_send
                        da_fragment_buffer = ""
                    if not data_to_send:
                        continue
                    await active_session.send(data_to_send)
                if payload.type == "resize" and payload.rows and payload.cols:
                    logger.info(
                        "ws-resize-recv session_id=%s user_id=%s rows=%s cols=%s",
                        session_id,
                        user.id,
                        payload.rows,
                        payload.cols,
                    )
                    await active_session.resize(payload.rows, payload.cols)
                    try:
                        pty = session_manager.deserialize_pty(record.pty_info)
                        pty.rows = payload.rows
                        pty.cols = payload.cols
                        record.pty_info = session_manager.serialize_pty(pty)
                        logger.info(
                            "ws-resize-pty-updated session_id=%s rows=%s cols=%s",
                            session_id,
                            pty.rows,
                            pty.cols,
                        )
                    except Exception:
                        record.pty_info = session_manager.serialize_pty(
                            PtyInfo(term="xterm-256color", rows=payload.rows, cols=payload.cols)
                        )
                        logger.warning(
                            "ws-resize-pty-reset session_id=%s rows=%s cols=%s",
                            session_id,
                            payload.rows,
                            payload.cols,
                        )
        except WebSocketDisconnect:
            return
        except Exception as exc:
            logging.getLogger(__name__).warning("terminal_socket error: %s", exc)
            return
        finally:
            bound_session.websockets.discard(websocket)
            latest_session = session_manager.get_session(session_id)
            if latest_session and latest_session is not bound_session:
                latest_session.websockets.discard(websocket)
            record.last_activity = utc_now()
    except Exception as exc:
        logging.getLogger(__name__).warning("terminal_socket setup error: %s", exc)
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
