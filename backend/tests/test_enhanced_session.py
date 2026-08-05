from __future__ import annotations

import asyncio
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pytest

from app.services.enhanced_session import (
    EnhancedSessionError,
    close_ssh_resources,
    ensure_remote_binary,
    is_retryable_enhanced_error,
    probe_remote_enhanced_environment,
)


@dataclass
class CommandResult:
    exit_status: int = 0
    stdout: str | bytes = ""
    stderr: str | bytes = ""


class RejectingSftpContext:
    async def __aenter__(self):
        raise RuntimeError("subsystem request failed")

    async def __aexit__(self, exc_type, exc, traceback) -> None:
        return None


class RecordingClient:
    def __init__(
        self,
        *,
        expected_size: int,
        version_exit_status: int = 0,
        install_exit_status: int = 0,
    ) -> None:
        self.expected_size = expected_size
        self.version_exit_status = version_exit_status
        self.install_exit_status = install_exit_status
        self.commands: list[tuple[str, dict[str, Any]]] = []
        self.sftp_attempts = 0

    def start_sftp_client(self) -> RejectingSftpContext:
        self.sftp_attempts += 1
        return RejectingSftpContext()

    async def run(self, command: str, **kwargs: Any) -> CommandResult:
        self.commands.append((command, kwargs))
        if command.startswith("test -x "):
            return CommandResult(exit_status=1)
        if "wc -c" in command:
            return CommandResult(stdout=f"{self.expected_size}\n")
        if command.startswith("chmod 700 ") and " && mv -f " in command:
            return CommandResult(exit_status=self.install_exit_status)
        if command.endswith(" -V"):
            return CommandResult(
                exit_status=self.version_exit_status,
                stdout="tmux 3.6a\n" if self.version_exit_status == 0 else "",
                stderr="cannot execute" if self.version_exit_status else "",
            )
        return CommandResult()


class ExistingBinaryClient(RecordingClient):
    async def run(self, command: str, **kwargs: Any) -> CommandResult:
        self.commands.append((command, kwargs))
        if command.startswith("test -x "):
            return CommandResult()
        if command.endswith(" -V"):
            return CommandResult(stdout="tmux 3.6a\n")
        return CommandResult()


class CapabilityClient:
    def __init__(self, *, directory_available: bool = True, executable: bool = True) -> None:
        self.directory_available = directory_available
        self.executable = executable
        self.commands: list[tuple[str, dict[str, Any]]] = []

    async def run(self, command: str, **kwargs: Any) -> CommandResult:
        self.commands.append((command, kwargs))
        if command.startswith("test -d "):
            return CommandResult(exit_status=0 if self.directory_available else 1)
        if "wc -c" in command:
            payload = next(
                call_kwargs["input"]
                for call_command, call_kwargs in self.commands
                if "cat >" in call_command
            )
            return CommandResult(stdout=f"{len(payload)}\n")
        if command.startswith("chmod 700 "):
            return CommandResult(exit_status=0 if self.executable else 126)
        return CommandResult()


class ClosingClient:
    def __init__(self) -> None:
        self.closed = False
        self.waited_closed = False

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        self.waited_closed = True


class FailingCloseChannel:
    def close(self) -> None:
        raise RuntimeError("channel close failed")


def _write_binary(path: Path, payload: bytes = b"tmux-static-binary") -> bytes:
    path.write_bytes(payload)
    return payload


def test_ensure_remote_binary_falls_back_to_ssh_stream_when_sftp_is_unavailable(tmp_path: Path) -> None:
    local_path = tmp_path / "tmux"
    payload = _write_binary(local_path)
    client = RecordingClient(expected_size=len(payload))

    upload_method = asyncio.run(ensure_remote_binary(client, local_path, "/tmp/tmux.aarch64"))

    assert upload_method == "ssh-stream"
    assert client.sftp_attempts == 1
    stream_calls = [kwargs for command, kwargs in client.commands if "cat >" in command]
    assert stream_calls == [{"input": payload, "encoding": None, "check": False}]
    assert any(command.endswith("/tmp/tmux.aarch64 -V") for command, _ in client.commands)


def test_ensure_remote_binary_rejects_size_mismatch_and_cleans_temporary_file(tmp_path: Path) -> None:
    local_path = tmp_path / "tmux"
    payload = _write_binary(local_path)
    client = RecordingClient(expected_size=len(payload) - 1)

    with pytest.raises(EnhancedSessionError, match="上传校验失败") as captured:
        asyncio.run(ensure_remote_binary(client, local_path, "/tmp/tmux.aarch64"))

    assert captured.value.retryable is False
    assert any(command.startswith("rm -f ") for command, _ in client.commands)
    assert not any(command.endswith("/tmp/tmux.aarch64 -V") for command, _ in client.commands)


def test_ensure_remote_binary_rejects_install_failure_and_cleans_temporary_file(tmp_path: Path) -> None:
    local_path = tmp_path / "tmux"
    payload = _write_binary(local_path)
    client = RecordingClient(expected_size=len(payload), install_exit_status=1)

    with pytest.raises(EnhancedSessionError, match="无法安装") as captured:
        asyncio.run(ensure_remote_binary(client, local_path, "/tmp/tmux.aarch64"))

    assert captured.value.retryable is False
    assert any(command.startswith("rm -f ") for command, _ in client.commands)
    assert not any(command.endswith("/tmp/tmux.aarch64 -V") for command, _ in client.commands)


def test_ensure_remote_binary_removes_invalid_installed_binary(tmp_path: Path) -> None:
    local_path = tmp_path / "tmux"
    payload = _write_binary(local_path)
    client = RecordingClient(expected_size=len(payload), version_exit_status=126)

    with pytest.raises(EnhancedSessionError, match="无法在目标机器上运行") as captured:
        asyncio.run(ensure_remote_binary(client, local_path, "/tmp/tmux.aarch64"))

    assert captured.value.retryable is False
    assert any(command == "rm -f /tmp/tmux.aarch64" for command, _ in client.commands)


def test_ensure_remote_binary_reuses_valid_existing_binary(tmp_path: Path) -> None:
    local_path = tmp_path / "tmux"
    payload = _write_binary(local_path)
    client = ExistingBinaryClient(expected_size=len(payload))

    upload_method = asyncio.run(ensure_remote_binary(client, local_path, "/tmp/tmux.aarch64"))

    assert upload_method == "existing"
    assert client.sftp_attempts == 0
    assert not any("cat >" in command for command, _ in client.commands)


def test_probe_remote_enhanced_environment_streams_and_executes_probe() -> None:
    client = CapabilityClient()

    asyncio.run(probe_remote_enhanced_environment(client))

    stream_calls = [kwargs for command, kwargs in client.commands if "cat >" in command]
    assert len(stream_calls) == 1
    assert stream_calls[0]["encoding"] is None
    assert isinstance(stream_calls[0]["input"], bytes)
    assert any(command.startswith("chmod 700 ") for command, _ in client.commands)
    assert any(command.startswith("rm -f ") for command, _ in client.commands)


def test_probe_remote_enhanced_environment_rejects_unwritable_directory() -> None:
    client = CapabilityClient(directory_available=False)

    with pytest.raises(EnhancedSessionError, match="临时目录不可写") as captured:
        asyncio.run(probe_remote_enhanced_environment(client))

    assert captured.value.retryable is False
    assert not any("cat >" in command for command, _ in client.commands)


def test_probe_remote_enhanced_environment_rejects_noexec_directory() -> None:
    client = CapabilityClient(executable=False)

    with pytest.raises(EnhancedSessionError, match="禁止执行") as captured:
        asyncio.run(probe_remote_enhanced_environment(client))

    assert captured.value.retryable is False
    assert any(command.startswith("rm -f ") for command, _ in client.commands)


def test_enhanced_error_retry_policy_distinguishes_deterministic_and_transient_errors() -> None:
    assert is_retryable_enhanced_error(EnhancedSessionError("noexec")) is False
    assert is_retryable_enhanced_error(EnhancedSessionError("temporary", retryable=True)) is True
    assert is_retryable_enhanced_error(ConnectionResetError("reset")) is True


def test_close_ssh_resources_still_closes_client_when_channel_close_fails() -> None:
    client = ClosingClient()

    asyncio.run(close_ssh_resources(client, FailingCloseChannel()))

    assert client.closed is True
    assert client.waited_closed is True
