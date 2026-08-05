from __future__ import annotations

import asyncio
import json
import logging
import shlex
import time
import uuid
from pathlib import Path
from typing import Any, Callable

import asyncssh

from app.core.db import utc_now
from app.models.connection import Connection
from app.services.enhanced_session import (
    EnhancedSessionError,
    close_ssh_resources,
    cleanup_tmux_session,
    ensure_remote_binary,
    initialize_tmux_session,
    probe_remote_enhanced_environment,
    resolve_keepalive_binary,
)
from app.services.managed_session import ManagedSession
from app.services.session_updates import SessionBroadcaster
from app.services.types import PtyInfo, SessionBuffer

LOGGER = logging.getLogger(__name__)
TARGET_PROBE_RTT_WINDOW = 8
TARGET_PROBE_TIMEOUT_SECONDS = 5.0
TARGET_PROBE_COMMAND = "printf '__wsg_probe__'"


class SessionManager:
    def __init__(
        self,
        keepalive_interval: int,
        broadcaster: SessionBroadcaster | None = None,
        known_hosts: str | None = None,
        allow_unknown_hosts: bool = False,
        auto_add_known_hosts: bool = True,
        on_session_disconnect: Callable[[str], None] | None = None,
        keepalive_binary_dir: str | None = None,
    ) -> None:
        self._sessions: dict[str, ManagedSession] = {}
        self._network_probe_tasks: dict[str, asyncio.Task[None]] = {}
        self._keepalive_interval = keepalive_interval
        self._known_hosts = known_hosts
        self._allow_unknown_hosts = allow_unknown_hosts
        self._auto_add_known_hosts = auto_add_known_hosts
        self._known_hosts_lock = asyncio.Lock()
        self._enhanced_connection_locks: dict[int, asyncio.Lock] = {}
        self._logger = logging.getLogger(__name__)
        self._broadcaster = broadcaster
        self._on_session_disconnect = on_session_disconnect
        self._keepalive_binary_dir = Path(keepalive_binary_dir).resolve() if keepalive_binary_dir else None

    def _schedule_tmux_probe(self, session: ManagedSession, rows: int, cols: int) -> None:
        async def _probe() -> None:
            for delay in (0.2, 1.0, 3.0, 8.0):
                await asyncio.sleep(delay)
                await session._collect_tmux_metrics(f"create_probe_{delay:.1f}s", rows, cols)

        asyncio.create_task(_probe())

    def _target_profile_interval_seconds(self, profile: str) -> float:
        if profile == "poor":
            return 12.0
        if profile == "degraded":
            return 7.0
        return 4.0

    def _compute_target_profile(self, avg_rtt_ms: int | None, jitter_ms: int, error_streak: int) -> str:
        if error_streak >= 2:
            return "poor"
        if avg_rtt_ms is None:
            if error_streak >= 1:
                return "degraded"
            return "unknown"
        if avg_rtt_ms >= 400 or jitter_ms >= 200:
            return "poor"
        if error_streak >= 1 or avg_rtt_ms >= 150 or jitter_ms >= 80:
            return "degraded"
        return "good"

    def _target_snapshot(self, session: ManagedSession) -> tuple[str, int | None, int | None, int, int]:
        return (
            session.target_profile,
            session.target_rtt_ms,
            session.target_avg_rtt_ms,
            session.target_jitter_ms,
            session.target_probe_error_streak,
        )

    def _apply_probe_success(self, session: ManagedSession, rtt_ms: int) -> bool:
        before = self._target_snapshot(session)
        session.target_rtt_samples = [*session.target_rtt_samples[-(TARGET_PROBE_RTT_WINDOW - 1) :], rtt_ms]
        session.target_rtt_ms = rtt_ms
        session.target_avg_rtt_ms = round(sum(session.target_rtt_samples) / len(session.target_rtt_samples))
        session.target_jitter_ms = (
            max(session.target_rtt_samples) - min(session.target_rtt_samples) if len(session.target_rtt_samples) >= 2 else 0
        )
        session.target_probe_error_streak = 0
        session.target_measured_at = utc_now()
        session.target_profile = self._compute_target_profile(
            session.target_avg_rtt_ms,
            session.target_jitter_ms,
            session.target_probe_error_streak,
        )
        return self._target_snapshot(session) != before

    def _apply_probe_failure(self, session: ManagedSession) -> bool:
        before = self._target_snapshot(session)
        session.target_rtt_ms = None
        session.target_probe_error_streak = min(session.target_probe_error_streak + 1, 10)
        session.target_measured_at = utc_now()
        session.target_profile = self._compute_target_profile(
            session.target_avg_rtt_ms,
            session.target_jitter_ms,
            session.target_probe_error_streak,
        )
        return self._target_snapshot(session) != before

    async def _broadcast_session_status(self, session: ManagedSession) -> None:
        if not self._broadcaster:
            return
        await self._broadcaster.broadcast(session.user_id, session.status_payload())

    async def _probe_target_network_once(self, session: ManagedSession) -> None:
        start = time.monotonic()
        changed = False
        try:
            result = await asyncio.wait_for(
                session.client.run(TARGET_PROBE_COMMAND, check=False),
                timeout=TARGET_PROBE_TIMEOUT_SECONDS,
            )
            if result.exit_status != 0:
                raise RuntimeError(f"probe exit status {result.exit_status}")
            elapsed_ms = max(1, round((time.monotonic() - start) * 1000))
            changed = self._apply_probe_success(session, elapsed_ms)
        except Exception as exc:
            changed = self._apply_probe_failure(session)
            self._logger.debug(
                "target network probe failed session_id=%s error=%s",
                session.session_id,
                exc,
            )

        if changed:
            await self._broadcast_session_status(session)

    async def _run_target_network_probe_loop(self, session_id: str) -> None:
        try:
            while True:
                session = self._sessions.get(session_id)
                if not session or session.status != "active" or not session.channel:
                    return
                await self._probe_target_network_once(session)
                await asyncio.sleep(self._target_profile_interval_seconds(session.target_profile))
        except asyncio.CancelledError:
            return

    def _cancel_target_network_probe(self, session_id: str) -> None:
        task = self._network_probe_tasks.pop(session_id, None)
        if task and not task.done():
            task.cancel()

    def _ensure_target_network_probe(self, session: ManagedSession) -> None:
        self._cancel_target_network_probe(session.session_id)
        self._network_probe_tasks[session.session_id] = asyncio.create_task(
            self._run_target_network_probe_loop(session.session_id)
        )

    def list_sessions(self, user_id: int) -> list[ManagedSession]:
        return [session for session in self._sessions.values() if session.user_id == user_id]

    def get_session(self, session_id: str) -> ManagedSession | None:
        return self._sessions.get(session_id)

    def _resolve_known_hosts_path(self) -> str:
        known_hosts = self._known_hosts or "~/.ssh/known_hosts"
        return str(Path(known_hosts).expanduser())

    def _ensure_known_hosts_path(self, known_hosts_path: str, create_file: bool) -> None:
        path = Path(known_hosts_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        if create_file and not path.exists():
            path.touch(mode=0o600, exist_ok=True)

    def _build_known_hosts_entry(self, host: str, port: int, host_key: asyncssh.SSHKey) -> str:
        label = host if port == 22 else f"[{host}]:{port}"
        key_data = host_key.export_public_key("openssh").decode("utf-8").strip()
        return f"{label} {key_data}\n"

    async def _fetch_host_key(self, connection: Connection) -> asyncssh.SSHKey:
        host_key = await asyncssh.get_server_host_key(connection.host, port=connection.port)
        if host_key is None:
            raise ValueError("Host key not provided by server")
        return host_key

    async def _open_client(
        self,
        connection: Connection,
        auth_payload: dict[str, Any],
        known_hosts: str | None,
    ) -> asyncssh.SSHClientConnection:
        client_keys = None
        if auth_payload.get("private_key"):
            try:
                passphrase = auth_payload.get("key_passphrase")
                key = asyncssh.import_private_key(auth_payload["private_key"], passphrase=passphrase)
                client_keys = [key]
            except Exception:
                raise ValueError("无效的私钥格式或密码错误")

        return await asyncssh.connect(
            connection.host,
            port=connection.port,
            username=connection.username,
            password=auth_payload.get("password"),
            client_keys=client_keys,
            known_hosts=known_hosts,
            keepalive_interval=self._keepalive_interval,
        )

    async def _connect_with_known_hosts(
        self,
        connection: Connection,
        auth_payload: dict[str, Any],
    ) -> asyncssh.SSHClientConnection:
        known_hosts_path = self._resolve_known_hosts_path()
        self._ensure_known_hosts_path(known_hosts_path, create_file=self._auto_add_known_hosts)
        return await self._open_client(connection, auth_payload, known_hosts_path)

    async def _append_known_host(self, known_hosts_path: str, entry: str) -> None:
        async with self._known_hosts_lock:
            self._ensure_known_hosts_path(known_hosts_path, create_file=self._auto_add_known_hosts)
            with open(known_hosts_path, "a", encoding="utf-8") as handle:
                handle.write(entry)

    async def _try_auto_add_known_host(self, connection: Connection) -> None:
        known_hosts_path = self._resolve_known_hosts_path()
        host_key = await self._fetch_host_key(connection)
        entry = self._build_known_hosts_entry(connection.host, connection.port, host_key)
        await self._append_known_host(known_hosts_path, entry)
        fingerprint = host_key.get_fingerprint("sha256")
        self._logger.info(
            "Added SSH host key to known_hosts (host=%s port=%s fingerprint=%s)",
            connection.host,
            connection.port,
            fingerprint,
        )

    async def connect_client(self, connection: Connection, auth_payload: dict[str, Any]) -> asyncssh.SSHClientConnection:
        if self._allow_unknown_hosts:
            return await self._open_client(connection, auth_payload, None)
        try:
            return await self._connect_with_known_hosts(connection, auth_payload)
        except asyncssh.HostKeyNotVerifiable:
            if not self._auto_add_known_hosts:
                raise
            await self._try_auto_add_known_host(connection)
            return await self._connect_with_known_hosts(connection, auth_payload)

    async def detect_remote_capabilities(
        self,
        connection: Connection,
        auth_payload: dict[str, Any],
    ) -> tuple[str, str, bool, str | None]:
        client = await self.connect_client(connection, auth_payload)
        try:
            arch_result = await client.run("uname -m", check=False)
            os_result = await client.run("uname -s", check=False)
            arch = (arch_result.stdout or "").strip()
            remote_os = (os_result.stdout or "").strip()
            if self.resolve_keepalive_binary(arch, remote_os) is None:
                return arch, remote_os, False, "当前目标机器不支持增强持久化连接"
            try:
                await probe_remote_enhanced_environment(client)
            except EnhancedSessionError as error:
                return arch, remote_os, False, str(error)
            return arch, remote_os, True, None
        finally:
            client.close()
            await client.wait_closed()

    async def detect_remote_platform(self, connection: Connection, auth_payload: dict[str, Any]) -> tuple[str, str]:
        arch, remote_os, _, _ = await self.detect_remote_capabilities(connection, auth_payload)
        return arch, remote_os

    def resolve_keepalive_binary(self, arch: str, remote_os: str) -> tuple[Path, str] | None:
        return resolve_keepalive_binary(self._keepalive_binary_dir, arch, remote_os)

    async def _ensure_remote_keepalive_binary(
        self,
        client: asyncssh.SSHClientConnection,
        local_path: Path,
        remote_path: str,
    ) -> str:
        method = await ensure_remote_binary(client, local_path, remote_path)
        self._logger.info(
            "enhanced binary ready local=%s remote=%s method=%s",
            local_path,
            remote_path,
            method,
        )
        return method

    async def _create_session_locked(
        self,
        connection: Connection,
        auth_payload: dict[str, Any],
        pty: PtyInfo,
        enhanced_enabled: bool = False,
        enhanced_fingerprint: str | None = None,
        tmux_binary_path: str | None = None,
        session_id: str | None = None,
    ) -> ManagedSession:
        client = await self.connect_client(connection, auth_payload)
        resolved_session_id = session_id or uuid.uuid4().hex
        session = ManagedSession(
            session_id=resolved_session_id,
            connection_id=connection.id,
            user_id=connection.user_id,
            client=client,
            channel=None,
            buffer=SessionBuffer(),
            last_activity=utc_now(),
            enhanced_enabled=enhanced_enabled,
            enhanced_fingerprint=enhanced_fingerprint,
            tmux_binary_path=tmux_binary_path,
        )
        created_tmux = False

        def _start_channel() -> asyncssh.SSHClientSession:
            manager = self

            class TerminalSession(asyncssh.SSHClientSession):
                def data_received(self, data: str, datatype: asyncssh.DataType | None = None) -> None:
                    session.buffer.append(data)
                    session.last_activity = utc_now()
                    if session.websockets:
                        for websocket in list(session.websockets):
                            asyncio.create_task(websocket.send_text(data))

                def connection_lost(self, exc: Exception | None) -> None:
                    current = manager._sessions.get(session.session_id)
                    # Ignore stale callbacks from replaced/explicitly-closed sessions.
                    if current is not session:
                        LOGGER.info(
                            "connection_lost ignored for stale session session_id=%s",
                            session.session_id,
                        )
                        return
                    session.status = "disconnected"
                    session.last_activity = utc_now()
                    manager._sessions.pop(session.session_id, None)
                    manager._cancel_target_network_probe(session.session_id)
                    if manager._broadcaster:
                        asyncio.create_task(manager._broadcaster.broadcast(session.user_id, session.status_payload()))
                    if manager._on_session_disconnect:
                        manager._on_session_disconnect(session.session_id)

            return TerminalSession()

        try:
            if enhanced_enabled:
                if not enhanced_fingerprint or not tmux_binary_path:
                    raise EnhancedSessionError("增强持久化会话参数不完整")
                keepalive = self.resolve_keepalive_binary(connection.remote_arch or "", connection.remote_os or "")
                if not keepalive:
                    raise EnhancedSessionError("当前目标机器不支持增强持久化连接")
                local_binary, _ = keepalive
                await self._ensure_remote_keepalive_binary(client, local_binary, tmux_binary_path)
                created_tmux = await initialize_tmux_session(
                    client,
                    tmux_binary_path,
                    enhanced_fingerprint,
                    pty,
                    resolved_session_id,
                )

            channel, _ = await client.create_session(
                session_factory=_start_channel,
                term_type=pty.term,
                term_size=(pty.cols, pty.rows),
                request_pty=True,
            )
            session.channel = channel

            if enhanced_enabled and enhanced_fingerprint and tmux_binary_path:
                channel.write(
                    f"exec {shlex.quote(tmux_binary_path)} attach -t {shlex.quote(enhanced_fingerprint)}\n"
                )
                self._schedule_tmux_probe(session, pty.rows, pty.cols)

            session.status = "active"
            replaced_session = self._sessions.get(resolved_session_id)
            self._sessions[resolved_session_id] = session
            self._ensure_target_network_probe(session)
            if replaced_session and replaced_session is not session:
                if replaced_session.websockets:
                    session.websockets.update(replaced_session.websockets)
                    replaced_session.websockets.clear()
                try:
                    await replaced_session.close()
                except Exception as error:
                    self._logger.warning(
                        "failed to close replaced session session_id=%s error=%s",
                        resolved_session_id,
                        error,
                    )
            return session
        except Exception:
            if created_tmux and enhanced_fingerprint and tmux_binary_path:
                await cleanup_tmux_session(client, tmux_binary_path, enhanced_fingerprint)
            await close_ssh_resources(client, session.channel)
            raise

    async def create_session(
        self,
        connection: Connection,
        auth_payload: dict[str, Any],
        pty: PtyInfo,
        enhanced_enabled: bool = False,
        enhanced_fingerprint: str | None = None,
        tmux_binary_path: str | None = None,
        session_id: str | None = None,
    ) -> ManagedSession:
        if enhanced_enabled:
            lock = self._enhanced_connection_locks.setdefault(connection.id, asyncio.Lock())
            async with lock:
                return await self._create_session_locked(
                    connection,
                    auth_payload,
                    pty,
                    enhanced_enabled,
                    enhanced_fingerprint,
                    tmux_binary_path,
                    session_id,
                )
        return await self._create_session_locked(
            connection,
            auth_payload,
            pty,
            enhanced_enabled,
            enhanced_fingerprint,
            tmux_binary_path,
            session_id,
        )

    async def _terminate_enhanced_tmux(self, session: ManagedSession) -> None:
        if not session.enhanced_enabled or not session.enhanced_fingerprint or not session.tmux_binary_path:
            return
        await cleanup_tmux_session(
            session.client,
            session.tmux_binary_path,
            session.enhanced_fingerprint,
        )

    async def close_session(self, session_id: str, terminate_enhanced: bool = False) -> None:
        self._cancel_target_network_probe(session_id)
        session = self._sessions.pop(session_id, None)
        if session:
            if terminate_enhanced:
                await self._terminate_enhanced_tmux(session)
            await session.close()

    async def open_enhanced_attach(
        self,
        connection: Connection,
        auth_payload: dict[str, Any],
        pty: PtyInfo,
        tmux_binary_path: str,
        fingerprint: str,
    ) -> ManagedSession:
        return await self.create_session(
            connection=connection,
            auth_payload=auth_payload,
            pty=pty,
            enhanced_enabled=True,
            enhanced_fingerprint=fingerprint,
            tmux_binary_path=tmux_binary_path,
        )

    def serialize_pty(self, pty: PtyInfo) -> str:
        return json.dumps({"term": pty.term, "rows": pty.rows, "cols": pty.cols})

    def deserialize_pty(self, payload: str) -> PtyInfo:
        data: dict[str, Any] = json.loads(payload)
        return PtyInfo(term=data.get("term", "xterm-256color"), rows=int(data.get("rows", 24)), cols=int(data.get("cols", 80)))
