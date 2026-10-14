from __future__ import annotations

import asyncio
import time
from typing import List

from fastapi import HTTPException

from app.core.logging import get_logger
from app.schemas.system_metrics import (
    CpuInfo, DiskInfo, DiskList, MemoryInfo, NetworkInfo,
    ProcessInfo, ProcessList, SwapInfo, SystemOverview, SystemStats,
)
from app.services import macos_metrics

logger = get_logger(__name__)


async def run_ssh_command(session_or_client, command: str, timeout: float = 5.0, *, required: bool = False) -> str:
    """通过临时 SSH 客户端采集输出，必要指标失败时返回明确错误。"""
    try:
        client = getattr(session_or_client, "client", session_or_client)
        result = await asyncio.wait_for(client.run(command, check=False), timeout=timeout)
        if required and (result.exit_status != 0 or not result.stdout.strip()):
            raise HTTPException(status_code=502, detail="目标机器的系统信息采集命令失败")
        return result.stdout or ""
    except HTTPException:
        raise
    except Exception as error:
        logger.warning("SSH 命令执行失败 command=%s error=%s", command, error)
        if required:
            raise HTTPException(status_code=502, detail="无法读取目标机器的系统信息") from error
        return ""


async def detect_metrics_platform(client) -> str:
    platform = (await run_ssh_command(client, "LC_ALL=C uname -s", required=True)).strip().lower()
    if platform not in {"linux", "darwin"}:
        raise HTTPException(status_code=502, detail="当前目标系统暂不支持系统监控")
    return platform


def parse_memory_info(meminfo: str) -> tuple[MemoryInfo, SwapInfo]:
    """解析 /proc/meminfo 输出"""
    mem_total = mem_available = mem_free = mem_buffers = mem_cached = 0
    swap_total = swap_free = 0

    for line in meminfo.splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        key = parts[0].rstrip(":")
        value = int(parts[1]) * 1024  # KB to bytes

        if key == "MemTotal":
            mem_total = value
        elif key == "MemAvailable":
            mem_available = value
        elif key == "MemFree":
            mem_free = value
        elif key == "Buffers":
            mem_buffers = value
        elif key == "Cached":
            mem_cached = value
        elif key == "SwapTotal":
            swap_total = value
        elif key == "SwapFree":
            swap_free = value

    # 如果没有 MemAvailable，用 Free + Buffers + Cached 估算
    if mem_available == 0:
        mem_available = mem_free + mem_buffers + mem_cached

    mem_used = mem_total - mem_available
    mem_percent = (mem_used / mem_total * 100) if mem_total > 0 else 0

    swap_used = swap_total - swap_free
    swap_percent = (swap_used / swap_total * 100) if swap_total > 0 else 0

    return (
        MemoryInfo(total=mem_total, used=mem_used, percent=round(mem_percent, 1)),
        SwapInfo(total=swap_total, used=swap_used, percent=round(swap_percent, 1))
    )


def parse_cpu_info(stat1: str, stat2: str, cpuinfo: str) -> CpuInfo:
    """解析 CPU 使用率"""
    def parse_cpu_line(line: str) -> tuple[int, int]:
        parts = line.split()
        if len(parts) < 5:
            return 0, 0
        # user, nice, system, idle, iowait, irq, softirq, steal
        values = [int(x) for x in parts[1:8] if x.isdigit()]
        if len(values) < 4:
            return 0, 0
        idle = values[3]
        total = sum(values)
        return idle, total

    idle1, total1 = 0, 0
    idle2, total2 = 0, 0

    for line in stat1.splitlines():
        if line.startswith("cpu "):
            idle1, total1 = parse_cpu_line(line)
            break

    for line in stat2.splitlines():
        if line.startswith("cpu "):
            idle2, total2 = parse_cpu_line(line)
            break

    diff_idle = idle2 - idle1
    diff_total = total2 - total1
    cpu_percent = 100.0 * (1.0 - diff_idle / diff_total) if diff_total > 0 else 0

    # 计算 CPU 核心数
    cpu_count = 0
    for line in cpuinfo.splitlines():
        if line.startswith("processor"):
            cpu_count += 1
    if cpu_count == 0:
        cpu_count = 1

    return CpuInfo(percent=round(cpu_percent, 1), count=cpu_count)


def parse_network_stats(net1: str, net2: str, interval: float) -> NetworkInfo:
    """解析 /proc/net/dev 输出计算网络速度
    格式:
    Inter-|   Receive                                                |  Transmit
     face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed
        lo: 1234567   12345    0    0    0     0          0         0  1234567   12345    0    0    0     0       0          0
      eth0: 1234567   12345    0    0    0     0          0         0  1234567   12345    0    0    0     0       0          0
    """
    def parse_net_dev(content: str) -> tuple[int, int]:
        total_rx = 0
        total_tx = 0
        for line in content.splitlines():
            line = line.strip()
            if ":" not in line or line.startswith("Inter") or line.startswith("face"):
                continue
            # 跳过 lo 回环接口
            if line.startswith("lo:"):
                continue
            parts = line.split()
            if len(parts) < 10:
                continue
            try:
                # 接口名后依次为收包计数与发包计数。
                # 第一部分可能是 "eth0:1234" 或 "eth0: 1234"
                if ":" in parts[0]:
                    iface_data = parts[0].split(":")
                    if len(iface_data) > 1 and iface_data[1]:
                        rx_bytes = int(iface_data[1])
                        tx_bytes = int(parts[7])
                    else:
                        rx_bytes = int(parts[1])
                        tx_bytes = int(parts[9])
                else:
                    rx_bytes = int(parts[1])
                    tx_bytes = int(parts[9])
                total_rx += rx_bytes
                total_tx += tx_bytes
            except (ValueError, IndexError):
                continue
        return total_rx, total_tx

    rx1, tx1 = parse_net_dev(net1)
    rx2, tx2 = parse_net_dev(net2)

    # 计算速度 (bytes/s)
    download_speed = int((rx2 - rx1) / interval) if interval > 0 else 0
    upload_speed = int((tx2 - tx1) / interval) if interval > 0 else 0

    # 防止负值（可能是计数器溢出）
    download_speed = max(0, download_speed)
    upload_speed = max(0, upload_speed)

    return NetworkInfo(upload_speed=upload_speed, download_speed=download_speed)


def parse_processes(ps_output: str) -> List[ProcessInfo]:
    """解析 ps 命令输出
    ps aux 输出格式:
    USER       PID %CPU %MEM    VSZ   RSS TTY      STAT START   TIME COMMAND
    root         1  0.0  0.1 169436 11896 ?        Ss   Feb28   0:03 /sbin/init
    """
    processes = []
    lines = ps_output.strip().splitlines()

    for line in lines[1:]:  # 跳过表头
        parts = line.split()
        if len(parts) < 11:
            continue
        try:
            pid = int(parts[1])
            cpu_percent = float(parts[2])
            mem_percent = float(parts[3])
            mem_kb = int(parts[5])  # RSS 位于第六列，单位为 KiB。
            # 命令及参数从第十一列开始。
            command = " ".join(parts[10:])
            # 取命令名，去掉路径和参数
            name = command.split()[0].split("/")[-1] if command else "unknown"
            # 去掉方括号（内核线程）
            name = name.strip("[]")

            processes.append(ProcessInfo(
                pid=pid,
                name=name[:32],  # 限制长度
                command=command[:256],  # 完整命令，限制长度
                cpu_percent=cpu_percent,
                memory_percent=mem_percent,
                memory_bytes=mem_kb * 1024,
            ))
        except (ValueError, IndexError):
            continue

    return processes


def parse_disks(df_output: str, block_size: int = 1) -> List[DiskInfo]:
    """解析 df 输出并返回挂载信息"""
    disks = []
    for line in df_output.strip().splitlines():
        parts = line.split(None, 5)
        if len(parts) >= 6 and parts[0].startswith("/"):
            try:
                total = int(parts[1]) * block_size
                used = int(parts[2]) * block_size
                percent = float(parts[4].rstrip("%"))
                mount = parts[5]
                disks.append(DiskInfo(mount=mount, total=total, used=used, percent=percent))
            except (ValueError, IndexError):
                continue
    return disks


async def collect_system_stats(client, platform: str | None = None) -> SystemStats:
    platform = platform or await detect_metrics_platform(client)
    if platform == "darwin":
        top_output, core_count, memory_output = await asyncio.gather(
            run_ssh_command(client, macos_metrics.CPU_COMMAND, timeout=10.0, required=True),
            run_ssh_command(client, macos_metrics.CORE_COUNT_COMMAND, required=True),
            run_ssh_command(client, macos_metrics.MEMORY_COMMAND, required=True),
        )
        try:
            cpu = macos_metrics.parse_cpu(top_output, core_count)
            memory, swap = macos_metrics.parse_memory(memory_output)
        except ValueError as error:
            raise HTTPException(status_code=502, detail=str(error)) from error
    else:
        stat1, meminfo, cpuinfo = await asyncio.gather(
            run_ssh_command(client, "cat /proc/stat"),
            run_ssh_command(client, "cat /proc/meminfo"),
            run_ssh_command(client, "cat /proc/cpuinfo"),
        )
        await asyncio.sleep(0.3)
        stat2 = await run_ssh_command(client, "cat /proc/stat")
        memory, swap = parse_memory_info(meminfo)
        cpu = parse_cpu_info(stat1, stat2, cpuinfo)
    return SystemStats(cpu=cpu, memory=memory, swap=swap)


async def collect_network_stats(client, platform: str | None = None) -> NetworkInfo:
    platform = platform or await detect_metrics_platform(client)
    command = macos_metrics.NETWORK_COMMAND if platform == "darwin" else "cat /proc/net/dev"
    first = await run_ssh_command(client, command, required=True)
    sampled_at = time.monotonic()
    await asyncio.sleep(0.5)
    second = await run_ssh_command(client, command, required=True)
    # 包含远程命令的实际耗时，避免高延迟连接把网速放大。
    interval = time.monotonic() - sampled_at
    parser = macos_metrics.parse_network if platform == "darwin" else parse_network_stats
    return parser(first, second, interval)


async def collect_processes(client) -> ProcessList:
    output = await run_ssh_command(
        client, "LC_ALL=C ps aux 2>/dev/null || LC_ALL=C ps -ef 2>/dev/null",
    )
    processes = parse_processes(output)
    processes.sort(key=lambda item: item.memory_bytes, reverse=True)
    return ProcessList(processes=processes[:20])


async def collect_disks(client, platform: str | None = None) -> DiskList:
    platform = platform or await detect_metrics_platform(client)
    command = macos_metrics.DISK_COMMAND if platform == "darwin" else "LC_ALL=C df -B1 | grep '^/'"
    output = await run_ssh_command(client, command, required=True)
    disks = parse_disks(output, block_size=1024 if platform == "darwin" else 1)
    if not disks:
        raise HTTPException(status_code=502, detail="无法解析目标机器的磁盘信息")
    return DiskList(disks=disks)


async def collect_system_overview(client) -> SystemOverview:
    """概览与独立指标接口使用相同的平台采集逻辑。"""
    platform = await detect_metrics_platform(client)
    stats, network, processes, disks = await asyncio.gather(
        collect_system_stats(client, platform),
        collect_network_stats(client, platform),
        collect_processes(client),
        collect_disks(client, platform),
    )
    return SystemOverview(stats=stats, network=network, processes=processes, disks=disks)
