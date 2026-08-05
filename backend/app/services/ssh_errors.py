from __future__ import annotations

import asyncssh

from app.services.enhanced_session import EnhancedSessionError


REMOTE_CLOSED_MESSAGE = "目标 SSH 服务在握手或通信期间关闭了连接，请检查精简 SSH 服务的连接限制和设备资源"

SSH_CONNECTION_EXCEPTIONS = (
    ValueError,
    OSError,
    TimeoutError,
    EOFError,
    asyncssh.Error,
    EnhancedSessionError,
)


def ssh_error_detail(error: Exception) -> str:
    if isinstance(error, EnhancedSessionError):
        return str(error)
    if isinstance(error, asyncssh.PermissionDenied):
        return "SSH 认证失败，请检查用户名、密码或私钥"
    if isinstance(error, asyncssh.HostKeyNotVerifiable):
        return "目标主机密钥无法验证"
    if isinstance(error, TimeoutError):
        return "网络连接超时"
    if isinstance(error, (EOFError, ConnectionResetError, BrokenPipeError, asyncssh.ConnectionLost)):
        return REMOTE_CLOSED_MESSAGE
    detail = str(error).strip()
    return detail or "连接目标失败"
