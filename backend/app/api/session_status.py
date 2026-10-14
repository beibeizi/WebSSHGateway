from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.dependencies import get_current_user, get_db, get_state
from app.api.system import resolve_ssh_client
from app.schemas.system_metrics import NetworkInfo, SystemStats
from app.services.system_metrics import collect_network_stats, collect_system_stats, detect_metrics_platform


router = APIRouter(prefix="/system", tags=["system"])


class SessionStatusSummary(BaseModel):
    stats: SystemStats
    network: NetworkInfo


async def collect_session_status_summary(client) -> SessionStatusSummary:
    """采集会话卡片所需的轻量系统摘要，避免拉取进程和磁盘列表。"""
    platform = await detect_metrics_platform(client)
    stats, network = await asyncio.gather(
        collect_system_stats(client, platform),
        collect_network_stats(client, platform),
    )

    return SessionStatusSummary(
        stats=stats,
        network=network,
    )


@router.get("/session-status/{session_id}", response_model=SessionStatusSummary)
async def get_session_status_summary(
    session_id: str,
    state=Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SessionStatusSummary:
    async with resolve_ssh_client(session_id, state, user, db) as client:
        return await collect_session_status_summary(client)
