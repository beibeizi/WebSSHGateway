from __future__ import annotations

import re

from app.schemas.system_metrics import CpuInfo, MemoryInfo, NetworkInfo, SwapInfo


CPU_COMMAND = "LC_ALL=C /usr/bin/top -l 2 -s 1 -n 0"
CORE_COUNT_COMMAND = "/usr/sbin/sysctl -n hw.logicalcpu"
MEMORY_COMMAND = (
    "export LC_ALL=C; /usr/sbin/sysctl -n hw.memsize; "
    "/usr/bin/vm_stat; /usr/sbin/sysctl vm.swapusage"
)
NETWORK_COMMAND = "LC_ALL=C /usr/sbin/netstat -ibn"
DISK_COMMAND = "LC_ALL=C /bin/df -kP"


def parse_cpu(top_output: str, core_count: str) -> CpuInfo:
    samples = re.findall(r"CPU usage:.*?([\d.]+)% idle", top_output)
    if not samples or not core_count.strip().isdigit():
        raise ValueError("无法解析 macOS CPU 信息")
    # top 首次采样是开机以来的平均值，只使用最后一次区间采样。
    percent = min(100.0, max(0.0, 100.0 - float(samples[-1])))
    return CpuInfo(percent=round(percent, 1), count=max(1, int(core_count.strip())))


def parse_memory(output: str) -> tuple[MemoryInfo, SwapInfo]:
    lines = output.strip().splitlines()
    page_match = re.search(r"page size of (\d+) bytes", output)
    if not lines or not lines[0].isdigit() or not page_match:
        raise ValueError("无法解析 macOS 内存信息")
    total = int(lines[0])
    page_size = int(page_match[1])
    pages = {name: int(value) for name, value in re.findall(r"^(Pages [\w ]+):\s+(\d+)\.", output, re.M)}
    if total <= 0 or page_size <= 0 or "Pages free" not in pages:
        raise ValueError("macOS 内存采样不完整")
    # 将空闲、非活跃及推测页作为可回收内存，避免把文件缓存全部视为占用。
    available = page_size * sum(pages.get(key, 0) for key in (
        "Pages free", "Pages inactive", "Pages speculative",
    ))
    used = min(total, max(0, total - available))

    swap_values = {
        name: int(float(value) * 1024 ** "BKMGT".index(unit.upper()))
        for name, value, unit in re.findall(r"(total|used)\s*=\s*([\d.]+)([BKMGT])", output, re.I)
    }
    if "total" not in swap_values or "used" not in swap_values:
        raise ValueError("无法解析 macOS 交换区信息")
    swap_total = swap_values["total"]
    swap_used = min(swap_total, max(0, swap_values["used"]))
    return (
        MemoryInfo(total=total, used=used, percent=round(used / total * 100, 1)),
        SwapInfo(total=swap_total, used=swap_used,
                 percent=round(swap_used / swap_total * 100, 1) if swap_total else 0),
    )


def parse_network_counters(output: str) -> dict[str, tuple[int, int]]:
    counters = {}
    for line in output.splitlines():
        parts = line.split()
        if len(parts) < 10 or not parts[2].startswith("<Link#"):
            continue
        name = parts[0].rstrip("*")
        if name.startswith("lo") or name in counters:
            continue
        try:
            # 无链路地址的接口少一列，从固定的七个计数器尾列读取。
            counters[name] = (int(parts[-5]), int(parts[-2]))
        except ValueError:
            continue
    return counters


def parse_network(first: str, second: str, interval: float) -> NetworkInfo:
    before = parse_network_counters(first)
    after = parse_network_counters(second)
    if interval <= 0:
        return NetworkInfo(upload_speed=0, download_speed=0)
    rx = tx = 0
    for name in before.keys() & after.keys():
        rx += max(0, after[name][0] - before[name][0])
        tx += max(0, after[name][1] - before[name][1])
    return NetworkInfo(upload_speed=int(tx / interval), download_speed=int(rx / interval))
