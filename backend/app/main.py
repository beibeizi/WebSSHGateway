from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update
from starlette.responses import JSONResponse, Response

from app.api import auth, connections, health, session_status, sessions, system, system_settings, ws_sessions
from app.api.dependencies import AppState, get_state
from app.api.middleware import RequestLoggingMiddleware
from app.core.db import utc_now
from app.core.i18n import localize_detail, resolve_http_language
from app.core.logging import get_logger, setup_logging
from app.core.state import build_state
from app.models.session import SessionRecord
from app.services.bootstrap import (
    ensure_admin_user,
    ensure_connection_arch_columns,
    ensure_session_enhanced_columns,
    ensure_session_note_column,
    ensure_session_order_column,
    ensure_system_settings,
)

logger = get_logger(__name__)


def create_app() -> FastAPI:
    (
        config,
        database,
        auth_service,
        session_manager,
        session_broadcaster,
        start_enhanced_retry_worker,
        start_session_sync_worker,
    ) = build_state()

    # 配置日志
    setup_logging(config.log_level)

    database.create_tables()
    ensure_session_note_column(database)
    ensure_connection_arch_columns(database)
    ensure_session_enhanced_columns(database)
    ensure_session_order_column(database)
    ensure_system_settings(database)

    with database.session() as db_session:
        ensure_admin_user(db_session, auth_service)

    # 服务器启动时，将所有 active 状态的会话标记为 disconnected
    # 因为内存中的 SSH 连接已经丢失。
    # 仅增强会话保留自动重连能力，普通会话一律禁用自动重连。
    with database.session() as db_session:
        result = db_session.execute(
            update(SessionRecord)
            .where(SessionRecord.status == "active")
            .values(
                status="disconnected",
                last_activity=utc_now(),
                disconnected_at=utc_now(),
                retry_cycle_count=0,
                allow_auto_retry=SessionRecord.enhanced_enabled,
            )
        )
        if result.rowcount > 0:
            logger.info("Marked %d stale sessions as disconnected", result.rowcount)

        normalized = db_session.execute(
            update(SessionRecord)
            .where(
                SessionRecord.enhanced_enabled.is_(False),
                SessionRecord.allow_auto_retry.is_(True),
            )
            .values(allow_auto_retry=False)
        )
        if normalized.rowcount > 0:
            logger.info("Normalized %d non-enhanced sessions with auto-retry disabled", normalized.rowcount)

    app_state = AppState(
        config=config,
        database=database,
        auth_service=auth_service,
        session_manager=session_manager,
        session_broadcaster=session_broadcaster,
        start_enhanced_retry_worker=start_enhanced_retry_worker,
        start_session_sync_worker=start_session_sync_worker,
    )

    app = FastAPI(title="WebSSH Gateway", version="0.1.0")
    app.dependency_overrides[get_state] = lambda: app_state

    @app.exception_handler(HTTPException)
    async def _localized_http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
        language = resolve_http_language(request)
        localized_detail = localize_detail(exc.detail, language)
        return JSONResponse(
            status_code=exc.status_code,
            headers=exc.headers,
            content={"detail": localized_detail},
        )

    @app.on_event("startup")
    async def _start_retry_worker() -> None:
        if app_state.start_enhanced_retry_worker:
            app_state.start_enhanced_retry_worker()
        if app_state.start_session_sync_worker:
            app_state.start_session_sync_worker()

    # 添加请求日志中间件
    app.add_middleware(RequestLoggingMiddleware)

    app.add_middleware(
        CORSMiddleware,
        allow_origins=config.cors_allow_origins or ["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(auth.router)
    app.include_router(connections.router)
    app.include_router(sessions.router)
    app.include_router(ws_sessions.router)
    app.include_router(health.router)
    app.include_router(system.router)
    app.include_router(system_settings.router)
    app.include_router(session_status.router)

    static_dir = Path(__file__).resolve().parent.parent / "frontend" / "dist"
    if static_dir.exists():
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="frontend")

        index_path = static_dir / "index.html"
        if index_path.exists():
            index_bytes = index_path.read_bytes()
            index_response = Response(content=index_bytes, media_type="text/html")
            spa_exact_paths = {"/", "/sessions", "/force-password", "/settings"}
            spa_prefix_paths = ("/terminal/",)

            def is_spa_document_request(request: Request) -> bool:
                if request.method != "GET":
                    return False
                if request.headers.get("authorization"):
                    return False
                accept = (request.headers.get("accept") or "").lower()
                if "text/html" not in accept:
                    return False
                path = request.url.path
                if path in spa_exact_paths:
                    return True
                return any(path.startswith(prefix) for prefix in spa_prefix_paths)

            @app.middleware("http")
            async def spa_fallback(request, call_next):
                if is_spa_document_request(request):
                    return index_response
                response = await call_next(request)
                if response.status_code != 404 or request.method != "GET":
                    return response
                path = request.url.path
                if path.startswith("/api") or path.startswith("/auth") or path.startswith("/sessions") or path.startswith("/system"):
                    return response
                return index_response

    return app


app = create_app()
