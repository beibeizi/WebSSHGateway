from __future__ import annotations

import json

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import select

from app.api.dependencies import AppState, get_current_user, get_db, get_state
from app.core.db import utc_now
from app.models.connection import Connection
from app.models.session import SessionRecord
from app.schemas.api import ConnectionCreateRequest, ConnectionResponse, ConnectionUpdateRequest, SessionStatusResponse
from app.services.crypto import CryptoService
from app.services.connection_probe import reset_connection_probe, run_connection_probe
from app.services.session_updates import SessionBroadcaster
from app.services.ssh_manager import SessionManager


router = APIRouter(prefix="/connections", tags=["connections"])


def _build_connection_response(conn: Connection) -> ConnectionResponse:
    return ConnectionResponse(
        id=conn.id,
        name=conn.name,
        host=conn.host,
        port=conn.port,
        username=conn.username,
        auth_type=conn.auth_type,
        remote_arch=conn.remote_arch,
        remote_os=conn.remote_os,
        remote_probe_status=conn.remote_probe_status or "unverified",
        remote_probe_error=conn.remote_probe_error,
        remote_probe_checked_at=conn.remote_probe_checked_at,
        enhanced_supported=bool(conn.enhanced_supported),
        enhanced_probe_error=conn.enhanced_probe_error,
        created_at=conn.created_at,
        updated_at=conn.updated_at,
    )


def _schedule_connection_probe(
    background_tasks: BackgroundTasks,
    state: AppState,
    connection: Connection,
    probe_version: int,
) -> None:
    background_tasks.add_task(
        run_connection_probe,
        database=state.database,
        config=state.config,
        session_manager=state.session_manager,
        connection_id=connection.id,
        user_id=connection.user_id,
        probe_version=probe_version,
    )


@router.get("", response_model=list[ConnectionResponse])
def list_connections(user=Depends(get_current_user), db=Depends(get_db)) -> list[ConnectionResponse]:
    connections = db.execute(select(Connection).where(Connection.user_id == user.id)).scalars().all()
    return [_build_connection_response(conn) for conn in connections]


@router.post("", response_model=ConnectionResponse)
def create_connection(
    payload: ConnectionCreateRequest,
    background_tasks: BackgroundTasks,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> ConnectionResponse:
    if payload.auth_type == "password" and not payload.password:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password required")
    if payload.auth_type == "private_key" and not payload.private_key:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Private key required")

    crypto = CryptoService(state.config.secret_keys)
    auth_payload = {"password": payload.password, "private_key": payload.private_key, "key_passphrase": payload.key_passphrase}
    encrypted = crypto.encrypt(json.dumps(auth_payload))
    auth_data = json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext})

    connection = Connection(
        user_id=user.id,
        name=payload.name,
        host=payload.host,
        port=payload.port,
        username=payload.username,
        auth_type=payload.auth_type,
        auth_data=auth_data,
    )
    probe_version = reset_connection_probe(connection)
    db.add(connection)
    db.flush()
    db.commit()
    db.refresh(connection)
    _schedule_connection_probe(background_tasks, state, connection, probe_version)

    return _build_connection_response(connection)


@router.put("/{connection_id}", response_model=ConnectionResponse)
def update_connection(
    connection_id: int,
    payload: ConnectionUpdateRequest,
    background_tasks: BackgroundTasks,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> ConnectionResponse:
    connection = db.execute(
        select(Connection).where(Connection.id == connection_id, Connection.user_id == user.id)
    ).scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    should_reprobe = False
    if payload.name is not None:
        connection.name = payload.name
    if payload.host is not None:
        should_reprobe = should_reprobe or payload.host != connection.host
        connection.host = payload.host
    if payload.port is not None:
        should_reprobe = should_reprobe or payload.port != connection.port
        connection.port = payload.port
    if payload.username is not None:
        should_reprobe = should_reprobe or payload.username != connection.username
        connection.username = payload.username

    if payload.auth_type is not None or payload.password is not None or payload.private_key is not None or payload.key_passphrase is not None:
        auth_type = payload.auth_type or connection.auth_type
        if auth_type == "password" and not payload.password:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Password required")
        if auth_type == "private_key" and not payload.private_key:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Private key required")
        crypto = CryptoService(state.config.secret_keys)
        auth_payload = {"password": payload.password, "private_key": payload.private_key, "key_passphrase": payload.key_passphrase}
        encrypted = crypto.encrypt(json.dumps(auth_payload))
        connection.auth_data = json.dumps({"nonce": encrypted.nonce, "ciphertext": encrypted.ciphertext})
        if payload.auth_type is not None:
            should_reprobe = should_reprobe or payload.auth_type != connection.auth_type
            connection.auth_type = payload.auth_type
        should_reprobe = True

    connection.updated_at = utc_now()
    probe_version = reset_connection_probe(connection) if should_reprobe else connection.remote_probe_version
    db.flush()
    db.commit()
    db.refresh(connection)
    if should_reprobe:
        _schedule_connection_probe(background_tasks, state, connection, probe_version)

    return _build_connection_response(connection)


@router.post("/{connection_id}/verify", response_model=ConnectionResponse)
def verify_connection(
    connection_id: int,
    background_tasks: BackgroundTasks,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> ConnectionResponse:
    connection = db.execute(
        select(Connection).where(Connection.id == connection_id, Connection.user_id == user.id)
    ).scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    probe_version = reset_connection_probe(connection)
    connection.updated_at = utc_now()
    db.flush()
    db.commit()
    db.refresh(connection)
    _schedule_connection_probe(background_tasks, state, connection, probe_version)
    return _build_connection_response(connection)


@router.delete("/{connection_id}")
async def delete_connection(
    connection_id: int,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    connection = db.execute(
        select(Connection).where(Connection.id == connection_id, Connection.user_id == user.id)
    ).scalar_one_or_none()
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    session_manager: SessionManager = state.session_manager
    broadcaster: SessionBroadcaster = state.session_broadcaster
    sessions = db.execute(
        select(SessionRecord).where(SessionRecord.connection_id == connection_id, SessionRecord.user_id == user.id)
    ).scalars().all()
    for record in sessions:
        if record.status == "active":
            record.status = "disconnected"
            record.last_activity = utc_now()
            record.disconnected_at = utc_now()
            record.allow_auto_retry = False
            record.retry_cycle_count = 0
            await session_manager.close_session(record.id, terminate_enhanced=True)
            await broadcaster.broadcast(
                user.id,
                SessionStatusResponse(id=record.id, status=record.status, last_activity=record.last_activity).model_dump_json(),
            )
        db.delete(record)

    db.delete(connection)
    return {"status": "ok"}
