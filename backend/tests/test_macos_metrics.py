from __future__ import annotations

import asyncio
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from app.services import macos_metrics as mac
from app.services import system_metrics as metrics
from test_system_metrics import MAC_DF, MAC_MEMORY, MAC_TOP, MetricsClient, mac_net


def test_cpu_uses_last_top_sample() -> None:
    cpu = mac.parse_cpu(MAC_TOP, "10\n")
    assert cpu.percent == 5.0
    assert cpu.count == 10


@pytest.mark.parametrize("top, cores", [("", "10"), (MAC_TOP, ""), ("missing", "8")])
def test_cpu_rejects_incomplete_output(top: str, cores: str) -> None:
    with pytest.raises(ValueError):
        mac.parse_cpu(top, cores)


@pytest.mark.parametrize("page_size", [4096, 16384])
def test_memory_uses_reported_page_size(page_size: int) -> None:
    output = MAC_MEMORY.replace("16384 bytes", f"{page_size} bytes")
    memory, swap = mac.parse_memory(output)
    assert memory.used == memory.total - 310000 * page_size
    assert swap.total == 1024**3
    assert swap.used == 256 * 1024**2
    assert swap.percent == 25.0


def test_memory_handles_disabled_swap() -> None:
    output = MAC_MEMORY.replace("1.00G", "0.00M").replace("256.00M", "0.00M")
    _, swap = mac.parse_memory(output)
    assert swap.total == swap.used == swap.percent == 0


@pytest.mark.parametrize("output", ["", "error\n", "0\npage size of 4096 bytes", "1024\npage size of 4096 bytes"])
def test_memory_rejects_incomplete_output(output: str) -> None:
    with pytest.raises(ValueError):
        mac.parse_memory(output)


def test_memory_rejects_missing_swap_data() -> None:
    with pytest.raises(ValueError):
        mac.parse_memory(MAC_MEMORY.split("vm.swapusage")[0])


def test_network_deduplicates_addresses_and_excludes_loopback() -> None:
    result = mac.parse_network(mac_net(1000, 500), mac_net(1500, 600), 0.5)
    assert result.download_speed == 1000
    assert result.upload_speed == 200


def test_network_handles_interfaces_without_link_address() -> None:
    assert mac.parse_network_counters("en0* 1500 <Link#3> 5 0 1000 4 0 500 0") == {"en0": (1000, 500)}


def test_network_ignores_new_disappeared_or_reset_interfaces() -> None:
    first = mac_net(1000, 500) + "en1 1500 <Link#4> 5 0 9000 4 0 9000 0\n"
    second = mac_net(10, 20) + "en2 1500 <Link#5> 5 0 90000 4 0 90000 0\n"
    result = mac.parse_network(first, second, 0.5)
    assert result.upload_speed == result.download_speed == 0


def test_network_skips_bad_counters_and_zero_interval() -> None:
    assert mac.parse_network_counters("en0 1500 <Link#2> 5 0 - 4 0 - 0") == {}
    assert mac.parse_network(mac_net(100, 10), mac_net(200, 20), 0).download_speed == 0


def test_disks_keep_spaces_and_convert_kib_to_bytes() -> None:
    disks = metrics.parse_disks(MAC_DF + "/dev/bad invalid 1 1 x% /bad\n", 1024)
    assert len(disks) == 3
    assert disks[-1].mount == "/Volumes/External Drive"
    assert disks[-1].total == 100000 * 1024
    assert disks[-1].used == 20000 * 1024
    assert disks[-1].percent == 20.0


def test_linux_memory_available_fallback() -> None:
    memory, swap = metrics.parse_memory_info(
        "MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 100 kB\nCached: 200 kB\n"
    )
    assert memory.percent == 60.0
    assert swap.total == 0


@pytest.mark.parametrize("platform", ["FreeBSD", ""])
def test_unknown_or_missing_platform_is_not_reported_as_zero(platform: str) -> None:
    with pytest.raises(HTTPException) as error:
        asyncio.run(metrics.detect_metrics_platform(MetricsClient(platform)))
    assert error.value.status_code == 502


@pytest.mark.parametrize("kind", ["empty", "nonzero", "timeout", "connection"])
def test_required_command_failures_are_visible(kind: str) -> None:
    class FailingClient:
        async def run(self, *args, **kwargs):
            if kind == "timeout":
                raise asyncio.TimeoutError()
            if kind == "connection":
                raise ConnectionError("closed")
            return SimpleNamespace(stdout="partial" if kind == "nonzero" else "", exit_status=1 if kind == "nonzero" else 0)

    with pytest.raises(HTTPException) as error:
        asyncio.run(metrics.run_ssh_command(FailingClient(), "probe", required=True))
    assert error.value.status_code == 502
    if kind in {"timeout", "connection"}:
        assert asyncio.run(metrics.run_ssh_command(FailingClient(), "probe")) == ""


def test_malformed_cpu_sampling_returns_gateway_error() -> None:
    class InvalidCpuClient(MetricsClient):
        async def run(self, command, **kwargs):
            if "/usr/bin/top" in command:
                return SimpleNamespace(stdout="CPU unavailable", exit_status=0)
            return await super().run(command, **kwargs)

    with pytest.raises(HTTPException) as error:
        asyncio.run(metrics.collect_system_stats(InvalidCpuClient()))
    assert error.value.status_code == 502


def test_unparseable_disk_output_returns_gateway_error() -> None:
    class InvalidDiskClient(MetricsClient):
        async def run(self, command, **kwargs):
            if "df -kP" in command:
                return SimpleNamespace(stdout="Filesystem only", exit_status=0)
            return await super().run(command, **kwargs)

    with pytest.raises(HTTPException) as error:
        asyncio.run(metrics.collect_disks(InvalidDiskClient()))
    assert error.value.status_code == 502
