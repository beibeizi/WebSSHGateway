from __future__ import annotations

import asyncio
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import ssh_manager as ssh_manager_module
from app.services.enhanced_session import EnhancedSessionError
from app.services.ssh_manager import SessionManager
from app.services.types import PtyInfo


class CommandResult:
    def __init__(self, exit_status: int = 0, stdout: str = "", stderr: str = "") -> None:
        self.exit_status = exit_status
        self.stdout = stdout
        self.stderr = stderr


class FakeChannel:
    def __init__(self, events: list[str]) -> None:
        self.events = events
        self.closed = False

    def write(self, data: str) -> None:
        self.events.append(f"write:{data.strip()}")

    def close(self) -> None:
        self.closed = True
        self.events.append("channel-close")


class FakeSshClient:
    def __init__(self, *, fail_pty: bool = False, fail_tmux_create: bool = False) -> None:
        self.fail_pty = fail_pty
        self.fail_tmux_create = fail_tmux_create
        self.events: list[str] = []
        self.commands: list[str] = []
        self.closed = False
        self.waited_closed = False
        self.tmux_exists = False

    async def run(self, command: str, **kwargs: Any) -> CommandResult:
        self.commands.append(command)
        self.events.append(f"run:{command}")
        if command == "uname -m":
            return CommandResult(stdout="aarch64\n")
        if command == "uname -s":
            return CommandResult(stdout="Linux\n")
        if "has-session" in command:
            return CommandResult(exit_status=0 if self.tmux_exists else 1)
        if "new-session" in command:
            if self.fail_tmux_create:
                return CommandResult(exit_status=1)
            self.tmux_exists = True
        if "kill-session" in command:
            self.tmux_exists = False
        return CommandResult()

    async def create_session(self, **kwargs: Any):
        self.events.append("pty")
        if self.fail_pty:
            raise RuntimeError("pty failed")
        return FakeChannel(self.events), None

    def close(self) -> None:
        self.closed = True
        self.events.append("client-close")

    async def wait_closed(self) -> None:
        self.waited_closed = True
        self.events.append("client-wait-closed")


def make_connection() -> SimpleNamespace:
    return SimpleNamespace(
        id=7,
        user_id=3,
        host="192.0.2.10",
        port=22,
        username="root",
        remote_arch="aarch64",
        remote_os="Linux",
    )


def make_manager(binary_dir: Path) -> SessionManager:
    binary_dir.mkdir(parents=True, exist_ok=True)
    (binary_dir / "keeplive.aarch64").write_bytes(b"tmux")
    return SessionManager(
        keepalive_interval=60,
        allow_unknown_hosts=True,
        keepalive_binary_dir=str(binary_dir),
    )


def test_detect_remote_capabilities_probes_environment_and_waits_for_close(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    client = FakeSshClient()
    probed: list[FakeSshClient] = []

    async def fake_connect(connection, auth_payload):
        return client

    async def fake_probe(probe_client):
        probed.append(probe_client)

    monkeypatch.setattr(manager, "connect_client", fake_connect)
    monkeypatch.setattr(ssh_manager_module, "probe_remote_enhanced_environment", fake_probe, raising=False)

    result = asyncio.run(manager.detect_remote_capabilities(make_connection(), {}))

    assert result == ("aarch64", "Linux", True, None)
    assert probed == [client]
    assert client.closed is True
    assert client.waited_closed is True


def test_detect_remote_capabilities_records_deterministic_probe_error(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    client = FakeSshClient()

    async def fake_connect(connection, auth_payload):
        return client

    async def fake_probe(probe_client):
        raise EnhancedSessionError("目标机器临时目录禁止执行文件，无法启用增强持久化连接")

    monkeypatch.setattr(manager, "connect_client", fake_connect)
    monkeypatch.setattr(ssh_manager_module, "probe_remote_enhanced_environment", fake_probe, raising=False)

    result = asyncio.run(manager.detect_remote_capabilities(make_connection(), {}))

    assert result == (
        "aarch64",
        "Linux",
        False,
        "目标机器临时目录禁止执行文件，无法启用增强持久化连接",
    )
    assert client.closed is True
    assert client.waited_closed is True


def test_enhanced_session_initializes_before_creating_pty(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    client = FakeSshClient()

    async def fake_connect(connection, auth_payload):
        return client

    async def fake_ensure(installer_client, local_path, remote_path):
        client.events.append("install")
        return "ssh-stream"

    monkeypatch.setattr(manager, "connect_client", fake_connect)
    monkeypatch.setattr(manager, "_ensure_remote_keepalive_binary", fake_ensure)

    async def scenario() -> None:
        session = await manager.create_session(
            connection=make_connection(),
            auth_payload={},
            pty=PtyInfo(term="xterm-256color", rows=24, cols=80),
            enhanced_enabled=True,
            enhanced_fingerprint="kp_test",
            tmux_binary_path="/tmp/tmux.aarch64",
        )
        await manager.close_session(session.session_id, terminate_enhanced=True)

    asyncio.run(scenario())

    assert client.events.index("install") < client.events.index("pty")


def test_enhanced_upload_failure_closes_client_without_creating_pty(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    client = FakeSshClient()

    async def fake_connect(connection, auth_payload):
        return client

    async def failing_ensure(installer_client, local_path, remote_path):
        raise EnhancedSessionError("无法向目标机器上传增强持久化组件")

    monkeypatch.setattr(manager, "connect_client", fake_connect)
    monkeypatch.setattr(manager, "_ensure_remote_keepalive_binary", failing_ensure)

    with pytest.raises(EnhancedSessionError, match="无法向目标机器上传"):
        asyncio.run(
            manager.create_session(
                connection=make_connection(),
                auth_payload={},
                pty=PtyInfo(term="xterm-256color", rows=24, cols=80),
                enhanced_enabled=True,
                enhanced_fingerprint="kp_test",
                tmux_binary_path="/tmp/tmux.aarch64",
            )
        )

    assert "pty" not in client.events
    assert client.closed is True
    assert client.waited_closed is True


def test_tmux_creation_failure_closes_client_without_creating_pty(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    client = FakeSshClient(fail_tmux_create=True)

    async def fake_connect(connection, auth_payload):
        return client

    async def fake_ensure(installer_client, local_path, remote_path):
        client.events.append("install")
        return "existing"

    monkeypatch.setattr(manager, "connect_client", fake_connect)
    monkeypatch.setattr(manager, "_ensure_remote_keepalive_binary", fake_ensure)

    with pytest.raises(EnhancedSessionError, match="无法在目标机器上创建"):
        asyncio.run(
            manager.create_session(
                connection=make_connection(),
                auth_payload={},
                pty=PtyInfo(term="xterm-256color", rows=24, cols=80),
                enhanced_enabled=True,
                enhanced_fingerprint="kp_test",
                tmux_binary_path="/tmp/tmux.aarch64",
            )
        )

    assert "pty" not in client.events
    assert any("kill-session" in command for command in client.commands)
    assert client.closed is True
    assert client.waited_closed is True


def test_pty_failure_removes_new_tmux_and_closes_client(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    client = FakeSshClient(fail_pty=True)

    async def fake_connect(connection, auth_payload):
        return client

    async def fake_ensure(installer_client, local_path, remote_path):
        client.events.append("install")
        return "existing"

    monkeypatch.setattr(manager, "connect_client", fake_connect)
    monkeypatch.setattr(manager, "_ensure_remote_keepalive_binary", fake_ensure)

    with pytest.raises(RuntimeError, match="pty failed"):
        asyncio.run(
            manager.create_session(
                connection=make_connection(),
                auth_payload={},
                pty=PtyInfo(term="xterm-256color", rows=24, cols=80),
                enhanced_enabled=True,
                enhanced_fingerprint="kp_test",
                tmux_binary_path="/tmp/tmux.aarch64",
            )
        )

    assert any("new-session" in command for command in client.commands)
    assert any("kill-session" in command for command in client.commands)
    assert client.tmux_exists is False
    assert client.closed is True
    assert client.waited_closed is True


def test_same_connection_enhanced_initialization_is_serialized(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    active = 0
    max_active = 0

    async def fake_create(*args, **kwargs):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.02)
        active -= 1
        return SimpleNamespace(session_id="test")

    monkeypatch.setattr(manager, "_create_session_locked", fake_create)
    connection = make_connection()
    pty = PtyInfo(term="xterm-256color", rows=24, cols=80)

    async def scenario() -> None:
        await asyncio.gather(
            manager.create_session(connection, {}, pty, enhanced_enabled=True),
            manager.create_session(connection, {}, pty, enhanced_enabled=True),
        )

    asyncio.run(scenario())

    assert max_active == 1


def test_different_connections_can_initialize_in_parallel(tmp_path: Path, monkeypatch) -> None:
    manager = make_manager(tmp_path / "bin")
    active = 0
    max_active = 0

    async def fake_create(*args, **kwargs):
        nonlocal active, max_active
        active += 1
        max_active = max(max_active, active)
        await asyncio.sleep(0.02)
        active -= 1
        return SimpleNamespace(session_id="test")

    monkeypatch.setattr(manager, "_create_session_locked", fake_create)
    first_connection = make_connection()
    second_connection = make_connection()
    second_connection.id = first_connection.id + 1
    pty = PtyInfo(term="xterm-256color", rows=24, cols=80)

    async def scenario() -> None:
        await asyncio.gather(
            manager.create_session(first_connection, {}, pty, enhanced_enabled=True),
            manager.create_session(second_connection, {}, pty, enhanced_enabled=True),
        )

    asyncio.run(scenario())

    assert max_active == 2
