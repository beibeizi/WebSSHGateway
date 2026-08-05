from __future__ import annotations

import logging
import shlex
import uuid
from pathlib import Path
from typing import Any

import asyncssh

from app.services.types import PtyInfo


logger = logging.getLogger(__name__)


class EnhancedSessionError(Exception):
    def __init__(self, message: str, *, retryable: bool = False) -> None:
        super().__init__(message)
        self.retryable = retryable


def is_retryable_enhanced_error(error: Exception) -> bool:
    return not isinstance(error, EnhancedSessionError) or error.retryable


def _result_text(value: Any) -> str:
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace").strip()
    return str(value or "").strip()


async def _remove_remote_file(client: asyncssh.SSHClientConnection, remote_path: str) -> None:
    try:
        await client.run(f"rm -f {shlex.quote(remote_path)}", check=False)
    except Exception as error:
        logger.debug("failed to remove remote temporary file path=%s error=%s", remote_path, error)


async def _verify_remote_binary(client: asyncssh.SSHClientConnection, remote_path: str) -> bool:
    result = await client.run(f"{shlex.quote(remote_path)} -V", check=False)
    return result.exit_status == 0 and "tmux" in _result_text(result.stdout).lower()


async def _upload_with_sftp(
    client: asyncssh.SSHClientConnection,
    local_path: Path,
    remote_path: str,
) -> None:
    async with client.start_sftp_client() as sftp:
        await sftp.put(str(local_path), remote_path)


async def _upload_with_ssh_stream(
    client: asyncssh.SSHClientConnection,
    payload: bytes,
    remote_path: str,
) -> None:
    result = await client.run(
        f"umask 077 && cat > {shlex.quote(remote_path)}",
        input=payload,
        encoding=None,
        check=False,
    )
    if result.exit_status != 0:
        raise EnhancedSessionError("无法向目标机器上传增强持久化组件，请检查临时目录权限和可用空间")


async def probe_remote_enhanced_environment(
    client: asyncssh.SSHClientConnection,
    remote_dir: str = "/tmp",
) -> None:
    quoted_directory = shlex.quote(remote_dir)
    directory_result = await client.run(
        f"test -d {quoted_directory} && test -w {quoted_directory}",
        check=False,
    )
    if directory_result.exit_status != 0:
        raise EnhancedSessionError("目标机器临时目录不可写，无法启用增强持久化连接")

    probe_payload = b"#!/bin/sh\nexit 0\n"
    probe_path = f"{remote_dir.rstrip('/')}/.webssh-enhanced-probe-{uuid.uuid4().hex}"
    quoted_probe = shlex.quote(probe_path)
    try:
        await _upload_with_ssh_stream(client, probe_payload, probe_path)
        size_result = await client.run(f"wc -c < {quoted_probe}", check=False)
        try:
            remote_size = int(_result_text(size_result.stdout)) if size_result.exit_status == 0 else -1
        except ValueError:
            remote_size = -1
        if remote_size != len(probe_payload):
            raise EnhancedSessionError("目标机器临时目录写入校验失败，无法启用增强持久化连接")

        execute_result = await client.run(
            f"chmod 700 {quoted_probe} && {quoted_probe}",
            check=False,
        )
        if execute_result.exit_status != 0:
            raise EnhancedSessionError("目标机器临时目录禁止执行文件，无法启用增强持久化连接")
    finally:
        await _remove_remote_file(client, probe_path)


def resolve_keepalive_binary(
    binary_dir: Path | None,
    arch: str,
    remote_os: str,
) -> tuple[Path, str] | None:
    if not binary_dir:
        return None

    normalized_arch = arch.strip().lower()
    normalized_os = remote_os.strip().lower()
    arch_alias = {
        "arm64": "aarch64",
        "x64": "x86_64",
        "amd64": "x86_64",
        "aarch64": "aarch64",
        "x86_64": "x86_64",
    }.get(normalized_arch, normalized_arch)

    filenames = {
        ("darwin", "aarch64"): "keeplive.macos-arm64",
        ("darwin", "x86_64"): "keeplive.macos-x86_64",
        ("linux", "aarch64"): "keeplive.aarch64",
        ("linux", "x86_64"): "keeplive.x86_64",
    }
    filename = filenames.get((normalized_os, arch_alias))
    if not filename:
        logger.warning(
            "unsupported enhanced binary arch=%s os=%s normalized_arch=%s normalized_os=%s",
            arch,
            remote_os,
            arch_alias,
            normalized_os,
        )
        return None

    binary_path = binary_dir / filename
    if not binary_path.is_file():
        logger.warning("enhanced binary missing path=%s arch=%s os=%s", binary_path, arch, remote_os)
        return None
    return binary_path, f"/tmp/tmux.{arch_alias}"


async def cleanup_tmux_session(
    client: asyncssh.SSHClientConnection,
    tmux_binary_path: str,
    fingerprint: str,
) -> None:
    try:
        await client.run(
            f"{shlex.quote(tmux_binary_path)} kill-session -t {shlex.quote(fingerprint)}",
            check=False,
        )
    except Exception as error:
        logger.warning("failed to clean up tmux session fingerprint=%s error=%s", fingerprint, error)


async def close_ssh_resources(
    client: asyncssh.SSHClientConnection,
    channel: asyncssh.SSHClientChannel | None = None,
) -> None:
    if channel:
        try:
            channel.close()
        except Exception as error:
            logger.warning(
                "failed to close SSH channel error_type=%s error=%s",
                type(error).__name__,
                error,
            )

    try:
        client.close()
    except Exception as error:
        logger.warning(
            "failed to initiate SSH client close error_type=%s error=%s",
            type(error).__name__,
            error,
        )

    try:
        await client.wait_closed()
    except Exception as error:
        logger.warning(
            "failed while waiting for SSH client close error_type=%s error=%s",
            type(error).__name__,
            error,
        )


async def initialize_tmux_session(
    client: asyncssh.SSHClientConnection,
    tmux_binary_path: str,
    fingerprint: str,
    pty: PtyInfo,
    session_id: str,
) -> bool:
    quoted_binary = shlex.quote(tmux_binary_path)
    quoted_fingerprint = shlex.quote(fingerprint)
    target_window = shlex.quote(f"{fingerprint}:0")
    target_pane = shlex.quote(f"{fingerprint}:0.0")
    existing = await client.run(f"{quoted_binary} has-session -t {quoted_fingerprint}", check=False)
    created = existing.exit_status != 0

    try:
        if created:
            create_result = await client.run(
                f"{quoted_binary} new-session -Ad -s {quoted_fingerprint} -x {pty.cols} -y {pty.rows}",
                check=False,
            )
            if create_result.exit_status != 0:
                raise EnhancedSessionError("无法在目标机器上创建增强持久化会话")

        option_commands = (
            f"{quoted_binary} set-option -t {quoted_fingerprint} status off",
            f"{quoted_binary} set-option -t {quoted_fingerprint} destroy-unattached off",
            f"{quoted_binary} set-option -t {quoted_fingerprint} mouse on",
            f"{quoted_binary} set-window-option -t {target_window} pane-border-status off",
            f"{quoted_binary} set-window-option -t {target_window} aggressive-resize on",
            f"{quoted_binary} set-window-option -t {target_window} window-size manual",
            f"{quoted_binary} resize-window -t {target_window} -x {pty.cols} -y {pty.rows}",
            f"{quoted_binary} resize-pane -t {target_pane} -x {pty.cols} -y {pty.rows}",
        )
        option_results = [await client.run(command, check=False) for command in option_commands]
        available = await client.run(f"{quoted_binary} has-session -t {quoted_fingerprint}", check=False)
        logger.info(
            "tmux initialized session_id=%s fingerprint=%s created=%s option_exits=%s has_exit=%s",
            session_id,
            fingerprint,
            created,
            [result.exit_status for result in option_results],
            available.exit_status,
        )
        if available.exit_status != 0:
            raise EnhancedSessionError("增强持久化会话创建后不可用，请检查目标机器资源")
        return created
    except Exception:
        if created:
            await cleanup_tmux_session(client, tmux_binary_path, fingerprint)
        raise


async def ensure_remote_binary(
    client: asyncssh.SSHClientConnection,
    local_path: Path,
    remote_path: str,
) -> str:
    quoted_remote = shlex.quote(remote_path)
    existing = await client.run(f"test -x {quoted_remote}", check=False)
    if existing.exit_status == 0:
        if await _verify_remote_binary(client, remote_path):
            return "existing"
        await _remove_remote_file(client, remote_path)

    payload = local_path.read_bytes()
    temporary_path = f"{remote_path}.upload-{uuid.uuid4().hex}"
    quoted_temporary = shlex.quote(temporary_path)
    upload_method = "sftp"
    installed = False

    try:
        try:
            await _upload_with_sftp(client, local_path, temporary_path)
        except Exception as error:
            upload_method = "ssh-stream"
            logger.info(
                "SFTP unavailable; falling back to SSH stream upload path=%s error_type=%s error=%s",
                remote_path,
                type(error).__name__,
                error,
            )
            await _remove_remote_file(client, temporary_path)
            await _upload_with_ssh_stream(client, payload, temporary_path)

        size_result = await client.run(f"wc -c < {quoted_temporary}", check=False)
        try:
            remote_size = int(_result_text(size_result.stdout)) if size_result.exit_status == 0 else -1
        except ValueError:
            remote_size = -1
        if remote_size != len(payload):
            raise EnhancedSessionError("增强持久化组件上传校验失败，请检查目标机器可用空间")

        install_result = await client.run(
            f"chmod 700 {quoted_temporary} && mv -f {quoted_temporary} {quoted_remote}",
            check=False,
        )
        if install_result.exit_status != 0:
            raise EnhancedSessionError("无法安装增强持久化组件，请检查目标临时目录权限")
        installed = True

        if not await _verify_remote_binary(client, remote_path):
            await _remove_remote_file(client, remote_path)
            raise EnhancedSessionError("增强持久化组件无法在目标机器上运行，请检查系统架构和执行权限")

        return upload_method
    finally:
        await _remove_remote_file(client, temporary_path)
        if not installed:
            logger.debug("enhanced binary installation did not complete path=%s", remote_path)
