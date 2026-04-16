from __future__ import annotations

from typing import Any

from fastapi import Request, WebSocket


DEFAULT_LANGUAGE = "zh-CN"
ENGLISH_LANGUAGE = "en-US"

_MESSAGE_CATALOG: dict[str, dict[str, str]] = {
    "unauthorized": {
        "zh": "未授权，请重新登录",
        "en": "Unauthorized",
    },
    "invalid_credentials": {
        "zh": "用户名或密码错误",
        "en": "Invalid username or password",
    },
    "account_locked": {
        "zh": "账号已锁定，请稍后再试",
        "en": "Account is locked. Please try again later.",
    },
    "incorrect_current_password": {
        "zh": "当前密码不正确",
        "en": "Current password is incorrect",
    },
    "password_mismatch": {
        "zh": "新密码不一致",
        "en": "New passwords do not match",
    },
    "password_policy": {
        "zh": "密码必须至少 8 位，并包含大小写字母和数字",
        "en": "Password must be 8+ chars with upper/lowercase and number",
    },
    "password_contains_username": {
        "zh": "密码不能包含用户名",
        "en": "Password must not contain username",
    },
    "user_not_found": {
        "zh": "用户不存在",
        "en": "User not found",
    },
    "password_reset_code_invalid": {
        "zh": "校验码错误或已过期",
        "en": "Verification code is invalid or expired",
    },
    "password_reset_cli_required": {
        "zh": "Web 端不支持重置密码，请联系管理员使用 CLI 重置密码",
        "en": "Password reset is not available on the web. Please contact an administrator to use the CLI reset command.",
    },
    "connection_not_found": {
        "zh": "连接不存在",
        "en": "Connection not found",
    },
    "session_not_found": {
        "zh": "会话不存在",
        "en": "Session not found",
    },
    "password_required": {
        "zh": "需要提供密码",
        "en": "Password required",
    },
    "private_key_required": {
        "zh": "需要提供私钥",
        "en": "Private key required",
    },
    "enhanced_not_supported": {
        "zh": "当前目标机器不支持增强持久化连接",
        "en": "Enhanced persistent connection is not supported on the target host",
    },
    "enhanced_not_enabled": {
        "zh": "该会话未开启增强持久化连接",
        "en": "Enhanced persistent connection is not enabled for this session",
    },
    "session_online_no_retry": {
        "zh": "会话当前在线，无需重试",
        "en": "Session is currently online. Retry is not needed",
    },
    "retry_disabled": {
        "zh": "当前会话已禁用重试",
        "en": "Retry is disabled for the current session",
    },
    "retry_failed": {
        "zh": "重试失败",
        "en": "Retry failed",
    },
    "invalid_file_path": {
        "zh": "非法文件路径",
        "en": "Invalid file path",
    },
    "directory_not_found_or_denied": {
        "zh": "目录不存在或无权访问",
        "en": "Directory does not exist or access is denied",
    },
    "invalid_private_key": {
        "zh": "无效的私钥格式或密码错误",
        "en": "Invalid private key format or passphrase",
    },
    "host_key_missing": {
        "zh": "服务端未返回主机指纹",
        "en": "Host key not provided by server",
    },
    "decrypt_payload_failed": {
        "zh": "解密认证信息失败",
        "en": "Unable to decrypt payload",
    },
    "session_not_active": {
        "zh": "会话未激活",
        "en": "Session not active",
    },
}

_MESSAGE_ALIAS_TO_KEY: dict[str, str] = {}
for message_key, translation in _MESSAGE_CATALOG.items():
    _MESSAGE_ALIAS_TO_KEY[translation["zh"]] = message_key
    _MESSAGE_ALIAS_TO_KEY[translation["en"]] = message_key


def normalize_language(raw_language: str | None) -> str:
    if not raw_language:
        return DEFAULT_LANGUAGE
    lowered = raw_language.lower()
    if lowered.startswith("en"):
        return ENGLISH_LANGUAGE
    return DEFAULT_LANGUAGE


def resolve_http_language(request: Request) -> str:
    return normalize_language(request.headers.get("X-Language"))


def resolve_websocket_language(websocket: WebSocket) -> str:
    return normalize_language(websocket.query_params.get("lang") or websocket.headers.get("X-Language"))


def translate_message(message: str, language: str) -> str:
    matched_key = _MESSAGE_ALIAS_TO_KEY.get(message)
    if not matched_key:
        return message
    locale = "en" if normalize_language(language) == ENGLISH_LANGUAGE else "zh"
    return _MESSAGE_CATALOG[matched_key][locale]


def localize_detail(detail: Any, language: str) -> Any:
    if isinstance(detail, str):
        return translate_message(detail, language)
    if isinstance(detail, list):
        return [localize_detail(item, language) for item in detail]
    if isinstance(detail, dict):
        localized: dict[str, Any] = {}
        for key, value in detail.items():
            if key in {"detail", "msg"} and isinstance(value, str):
                localized[key] = translate_message(value, language)
                continue
            localized[key] = localize_detail(value, language)
        return localized
    return detail
