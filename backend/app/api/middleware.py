from __future__ import annotations

import time

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

from app.core.logging import get_logger, set_request_id

logger = get_logger(__name__)


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    """请求日志中间件，记录请求追踪信息"""

    async def dispatch(self, request: Request, call_next) -> Response:
        # 设置请求追踪 ID（优先使用客户端传入的）
        client_request_id = request.headers.get("X-Request-ID")
        request_id = set_request_id(client_request_id)

        start_time = time.time()
        method = request.method
        path = request.url.path

        try:
            response = await call_next(request)
            duration_ms = (time.time() - start_time) * 1000
            status_code = response.status_code

            # 根据状态码选择日志级别
            if status_code >= 500:
                logger.error(
                    "%s %s -> %d (%.1fms)",
                    method, path, status_code, duration_ms
                )
            elif status_code >= 400:
                logger.warning(
                    "%s %s -> %d (%.1fms)",
                    method, path, status_code, duration_ms
                )
            else:
                # 跳过健康检查和静态资源的成功日志
                if not (path == "/health" or path.startswith("/assets")):
                    logger.info(
                        "%s %s -> %d (%.1fms)",
                        method, path, status_code, duration_ms
                    )

            # 在响应头中返回请求 ID
            response.headers["X-Request-ID"] = request_id
            return response

        except Exception as e:
            duration_ms = (time.time() - start_time) * 1000
            logger.exception(
                "%s %s -> 500 (%.1fms) error: %s",
                method, path, duration_ms, str(e)
            )
            raise
