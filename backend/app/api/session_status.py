from __future__ import annotations

import asyncio

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from app.api.dependencies import get_current_user, get_db, get_state
from app.api.system import (
    NetworkInfo,
    SystemStats,
    parse_cpu_info,
    parse_memory_info,
    parse_network_stats,
    resolve_ssh_client,
    run_ssh_command,
)


router = APIRouter(prefix="/system", tags=["system"])


class SessionStatusSummary(BaseModel):
    stats: SystemStats
    network: NetworkInfo


async def collect_session_status_summary(client) -> SessionStatusSummary:
    """采集会话卡片所需的轻量系统摘要，避免拉取进程和磁盘列表。"""
    stat1, meminfo, cpuinfo, net1 = await asyncio.gather(
        run_ssh_command(client, "cat /proc/stat"),
        run_ssh_command(client, "cat /proc/meminfo"),
        run_ssh_command(client, "cat /proc/cpuinfo"),
        run_ssh_command(client, "cat /proc/net/dev"),
    )

    interval = 0.5
    await asyncio.sleep(interval)
    stat2, net2 = await asyncio.gather(
        run_ssh_command(client, "cat /proc/stat"),
        run_ssh_command(client, "cat /proc/net/dev"),
    )

    memory, swap = parse_memory_info(meminfo)
    cpu = parse_cpu_info(stat1, stat2, cpuinfo)
    network = parse_network_stats(net1, net2, interval)

    return SessionStatusSummary(
        stats=SystemStats(cpu=cpu, memory=memory, swap=swap),
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
