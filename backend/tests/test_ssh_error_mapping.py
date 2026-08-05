from __future__ import annotations

import asyncio

import asyncssh
import pytest

from app.api.sessions import _target_connection_error_detail
from app.core.i18n import translate_message
from app.services.connection_probe import connection_probe_error_detail
from app.services.enhanced_session import EnhancedSessionError
from app.services.ssh_errors import SSH_CONNECTION_EXCEPTIONS, ssh_error_detail


REMOTE_CLOSED_MESSAGE = "目标 SSH 服务在握手或通信期间关闭了连接，请检查精简 SSH 服务的连接限制和设备资源"


def test_incomplete_read_error_has_actionable_message_across_entry_points() -> None:
    error = asyncio.IncompleteReadError(b"", 4)

    assert isinstance(error, SSH_CONNECTION_EXCEPTIONS)
    assert ssh_error_detail(error) == REMOTE_CLOSED_MESSAGE
    assert connection_probe_error_detail(error) == REMOTE_CLOSED_MESSAGE
    assert _target_connection_error_detail(error) == REMOTE_CLOSED_MESSAGE


def test_connection_lost_and_eof_use_remote_closed_message() -> None:
    assert ssh_error_detail(EOFError()) == REMOTE_CLOSED_MESSAGE
    assert ssh_error_detail(asyncssh.ConnectionLost("connection lost")) == REMOTE_CLOSED_MESSAGE


def test_enhanced_session_error_preserves_actionable_detail() -> None:
    error = EnhancedSessionError("目标机器临时目录禁止执行文件，无法启用增强持久化连接")

    assert isinstance(error, SSH_CONNECTION_EXCEPTIONS)
    assert ssh_error_detail(error) == "目标机器临时目录禁止执行文件，无法启用增强持久化连接"


def test_remote_closed_message_has_english_translation() -> None:
    assert translate_message(REMOTE_CLOSED_MESSAGE, "en-US") == (
        "The target SSH service closed the connection during handshake or communication. "
        "Check connection limits and device resources on the lightweight SSH server."
    )


@pytest.mark.parametrize(
    ("chinese", "english"),
    [
        (
            "目标机器临时目录不可写，无法启用增强持久化连接",
            "The target temporary directory is not writable. Enhanced persistence cannot be enabled.",
        ),
        (
            "目标机器临时目录禁止执行文件，无法启用增强持久化连接",
            "The target temporary directory does not allow execution. Enhanced persistence cannot be enabled.",
        ),
        (
            "无法向目标机器上传增强持久化组件，请检查临时目录权限和可用空间",
            "Failed to upload the enhanced persistence component. Check temporary directory permissions and free space.",
        ),
        (
            "增强持久化组件上传校验失败，请检查目标机器可用空间",
            "Enhanced persistence component upload verification failed. Check free space on the target host.",
        ),
        (
            "增强持久化组件无法在目标机器上运行，请检查系统架构和执行权限",
            "The enhanced persistence component cannot run on the target host. Check architecture and execute permissions.",
        ),
        (
            "无法在目标机器上创建增强持久化会话",
            "Failed to create an enhanced persistent session on the target host.",
        ),
    ],
)
def test_enhanced_session_errors_have_english_translations(chinese: str, english: str) -> None:
    assert translate_message(chinese, "en-US") == english
