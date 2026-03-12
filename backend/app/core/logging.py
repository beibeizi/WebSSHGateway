from __future__ import annotations

import logging
import sys
import uuid
from contextvars import ContextVar
from typing import Any

# 请求追踪 ID
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)


def get_request_id() -> str | None:
    """获取当前请求的追踪 ID"""
    return request_id_var.get()


def set_request_id(request_id: str | None = None) -> str:
    """设置当前请求的追踪 ID，未提供时自动生成"""
    if request_id is None:
        request_id = uuid.uuid4().hex[:8]
    request_id_var.set(request_id)
    return request_id


class RequestIdFilter(logging.Filter):
    """在日志记录中添加请求 ID"""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = get_request_id() or "-"
        return True


class StructuredFormatter(logging.Formatter):
    """结构化日志格式化器"""

    def __init__(self, include_request_id: bool = True) -> None:
        self.include_request_id = include_request_id
        super().__init__()

    def format(self, record: logging.LogRecord) -> str:
        # 基础格式
        timestamp = self.formatTime(record, "%Y-%m-%d %H:%M:%S")
        level = record.levelname
        name = record.name
        message = record.getMessage()

        # 构建日志行
        if self.include_request_id:
            request_id = getattr(record, "request_id", "-")
            line = f"{timestamp} [{level}] [{request_id}] {name}: {message}"
        else:
            line = f"{timestamp} [{level}] {name}: {message}"

        # 添加异常信息
        if record.exc_info:
            line += "\n" + self.formatException(record.exc_info)

        return line


def setup_logging(level: str = "INFO") -> None:
    """配置全局日志"""
    root_logger = logging.getLogger()
    root_logger.setLevel(level.upper())

    # 清除现有处理器
    for handler in root_logger.handlers[:]:
        root_logger.removeHandler(handler)

    # 控制台处理器
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(level.upper())
    console_handler.addFilter(RequestIdFilter())
    console_handler.setFormatter(StructuredFormatter(include_request_id=True))
    root_logger.addHandler(console_handler)

    # 减少第三方库日志噪音
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("asyncssh").setLevel(logging.WARNING)


def get_logger(name: str) -> logging.Logger:
    """获取带请求 ID 过滤器的日志记录器"""
    logger = logging.getLogger(name)
    return logger
