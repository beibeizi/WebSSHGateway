from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace

import pytest

from app.api import system


MAC_TOP = """CPU usage: 80.00% user, 10.00% sys, 10.00% idle
CPU usage: 2.00% user, 3.00% sys, 95.00% idle
"""
MAC_MEMORY = """17179869184
Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free: 100000.
Pages active: 300000.
Pages inactive: 200000.
Pages speculative: 10000.
Pages wired down: 100000.
Pages occupied by compressor: 100000.
vm.swapusage: total = 1.00G  used = 256.00M  free = 768.00M (encrypted)
"""
MAC_DF = """Filesystem 1024-blocks Used Available Capacity Mounted on
/dev/disk3s1s1 239362496 13338412 195212504 7% /
devfs 198 198 0 100% /dev
/dev/disk3s5 239362496 18412492 195212504 9% /System/Volumes/Data
/dev/disk4s1 100000 20000 80000 20% /Volumes/External Drive
"""
PS_OUTPUT = """USER PID %CPU %MEM VSZ RSS TT STAT STARTED TIME COMMAND
user 42 2.0 0.5 999999 8192 ?? S 12:00PM 0:01.00 /usr/bin/example --flag
"""


def mac_net(rx: int, tx: int) -> str:
    return f"""Name Mtu Network Address Ipkts Ierrs Ibytes Opkts Oerrs Obytes Coll
lo0 16384 <Link#1> 100 0 999999 100 0 999999 0
en0 1500 <Link#2> aa:bb:cc:dd:ee:ff 20 0 {rx} 10 0 {tx} 0
en0 1500 192.0.2 192.0.2.1 20 - {rx} 10 - {tx} -
en0 1500 fe80:: fe80::1 20 - {rx} 10 - {tx} -
"""


class MetricsClient:
    def __init__(self, platform: str = "Darwin") -> None:
        self.platform = platform
        self.commands: list[str] = []
        self.net_samples = 0
        self.cpu_samples = 0

    async def run(self, command: str, check: bool = False):
        self.commands.append(command)
        if "uname -s" in command:
            output = self.platform + "\n"
        elif self.platform == "Darwin" and "/proc/" in command:
            output = ""
        elif "hw.logicalcpu" in command:
            output = "10\n"
        elif "/usr/bin/top" in command:
            output = MAC_TOP
        elif "hw.memsize" in command:
            output = MAC_MEMORY
        elif "netstat" in command:
            self.net_samples += 1
            output = mac_net(10000 + 500 * self.net_samples, 20000 + 100 * self.net_samples)
        elif "df -kP" in command:
            output = MAC_DF
        elif "ps aux" in command:
            output = PS_OUTPUT
        elif "/proc/stat" in command:
            self.cpu_samples += 1
            output = f"cpu {100 + self.cpu_samples * 20} 0 50 {500 + self.cpu_samples * 80} 0 0 0\n"
        elif "/proc/cpuinfo" in command:
            output = "processor : 0\nprocessor : 1\n"
        elif "/proc/meminfo" in command:
            output = "MemTotal: 10000 kB\nMemAvailable: 4000 kB\nSwapTotal: 2000 kB\nSwapFree: 1500 kB\n"
        elif "/proc/net/dev" in command:
            self.net_samples += 1
            output = f"eth0: {10000 + self.net_samples * 500} 0 0 0 0 0 0 0 {20000 + self.net_samples * 100} 0 0 0 0 0 0 0\n"
        elif "df -B1" in command:
            output = "/dev/root 1024000 204800 819200 20% /\n" if self.platform == "Linux" else ""
        else:
            output = ""
        return SimpleNamespace(stdout=output, stderr="", exit_status=0)


def test_darwin_overview_uses_native_metrics() -> None:
    client = MetricsClient()
    overview = asyncio.run(system.collect_system_overview(client))

    assert overview.stats.cpu.count == 10
    assert overview.stats.cpu.percent == 5.0
    assert overview.stats.memory.total == 16 * 1024**3
    assert 0 < overview.stats.memory.used < overview.stats.memory.total
    assert overview.stats.swap.used == 256 * 1024**2
    assert overview.network.download_speed > 0
    assert overview.processes.processes[0].pid == 42
    assert overview.disks.disks[0].total == 239362496 * 1024
    assert overview.disks.disks[-1].mount == "/Volumes/External Drive"
    assert not any("/proc/" in command or "df -B1" in command for command in client.commands)


def test_linux_overview_keeps_proc_metrics() -> None:
    overview = asyncio.run(system.collect_system_overview(MetricsClient("Linux")))

    assert overview.stats.cpu.count == 2
    assert overview.stats.cpu.percent == 20.0
    assert overview.stats.memory.total == 10000 * 1024
    assert overview.stats.memory.percent == 60.0
    assert overview.stats.swap.percent == 25.0
    assert overview.processes.processes[0].memory_bytes == 8192 * 1024
    assert overview.disks.disks[0].mount == "/"


@pytest.mark.parametrize("endpoint", ["get_system_stats", "get_network_stats", "get_processes", "get_disks"])
def test_standalone_metrics_use_darwin_commands(monkeypatch, endpoint: str) -> None:
    client = MetricsClient()

    @asynccontextmanager
    async def resolve(*args):
        yield client

    monkeypatch.setattr(system, "resolve_ssh_client", resolve)
    result = asyncio.run(getattr(system, endpoint)("session", None, None, None))
    if endpoint == "get_system_stats":
        assert result.cpu.count == 10
        assert result.memory.total > 0
    elif endpoint == "get_network_stats":
        assert result.download_speed > 0
    elif endpoint == "get_disks":
        assert result.disks[0].total > 0
    else:
        assert result.processes[0].pid == 42
    assert not any("/proc/" in command or "df -B1" in command for command in client.commands)


@pytest.mark.parametrize("platform", ["Darwin", "Linux"])
def test_session_summary_uses_same_platform_collectors(platform: str) -> None:
    from app.api.session_status import collect_session_status_summary

    client = MetricsClient(platform)
    summary = asyncio.run(collect_session_status_summary(client))
    assert summary.stats.cpu.count == (10 if platform == "Darwin" else 2)
    assert summary.stats.memory.total > 0
    assert summary.network.download_speed > 0
    assert not any("ps aux" in command or "df " in command for command in client.commands)


def test_macos_file_size_guard_supports_bsd_stat(monkeypatch) -> None:
    class FileClient:
        async def run(self, command, check=False):
            size = "2097152" if "stat -f %z" in command else "0"
            return SimpleNamespace(stdout=size, exit_status=0)

    @asynccontextmanager
    async def resolve(*args):
        yield FileClient()

    monkeypatch.setattr(system, "resolve_ssh_client", resolve)
    result = asyncio.run(system.read_file("session", "/file.txt", False, None, None, None))
    assert result == {"size": 2097152, "too_large": True}
