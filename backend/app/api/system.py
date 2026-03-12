from __future__ import annotations

import asyncio
import re
import tempfile
import os
import tarfile
from pathlib import Path
from typing import List
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.api.dependencies import AppState, get_current_user, get_state

router = APIRouter(prefix="/system", tags=["system"])


class MemoryInfo(BaseModel):
    total: int  # 总量 bytes
    used: int   # 已用 bytes
    percent: float  # 鐧惧垎姣?


class SwapInfo(BaseModel):
    total: int
    used: int
    percent: float


class CpuInfo(BaseModel):
    percent: float  # CPU 使用率百分比
    count: int      # CPU 鏍稿績鏁?


class NetworkInfo(BaseModel):
    upload_speed: int    # 上传速度 bytes/s
    download_speed: int  # 下载速度 bytes/s


class SystemStats(BaseModel):
    cpu: CpuInfo
    memory: MemoryInfo
    swap: SwapInfo


class ProcessInfo(BaseModel):
    pid: int
    name: str
    command: str  # 完整命令/路径
    cpu_percent: float
    memory_percent: float
    memory_bytes: int


class ProcessList(BaseModel):
    processes: List[ProcessInfo]


class FileInfo(BaseModel):
    name: str
    path: str
    is_dir: bool
    size: int
    modified: str
    permissions: str
    owner: str
    group: str


class DirectoryListing(BaseModel):
    path: str
    files: List[FileInfo]


class DiskInfo(BaseModel):
    mount: str
    total: int
    used: int
    percent: float


class DiskList(BaseModel):
    disks: List[DiskInfo]


class SystemOverview(BaseModel):
    stats: SystemStats
    network: NetworkInfo
    processes: ProcessList
    disks: DiskList


class FileContent(BaseModel):
    content: str


class UploadResult(BaseModel):
    status: str = "ok"
    uploaded: int
    skipped: int
    failed: int
    errors: List[str]


def sanitize_shell_path(value: str) -> str:
    return value.replace("'", "").replace('"', "").replace(";", "").replace("&", "").replace("|", "")


def sanitize_upload_filename(filename: str | None, fallback: str = "file") -> str:
    name = (filename or fallback).strip().replace("\\", "/")
    if not name:
        name = fallback
    safe = Path(name).name
    if safe in {"", ".", ".."}:
        safe = fallback
    return safe


def sanitize_upload_relative_path(filename: str | None, fallback: str = "file") -> str:
    raw = (filename or fallback).strip().replace("\\", "/")
    if not raw:
        raw = fallback

    parts = [part for part in raw.split("/") if part not in {"", ".", ".."}]
    if not parts:
        return fallback

    return "/".join(parts)


def ensure_within_directory(base_dir: str, target_path: str) -> str:
    base_real = os.path.realpath(base_dir)
    target_real = os.path.realpath(target_path)
    if os.path.commonpath([base_real, target_real]) != base_real:
        raise HTTPException(status_code=400, detail="非法文件路径")
    return target_real


def create_tar_gz(archive_path: str, source_path: str, arcname: str) -> None:
    with tarfile.open(archive_path, "w:gz") as tar:
        tar.add(source_path, arcname=arcname)


def build_upload_result(
    uploaded: int = 0,
    skipped: int = 0,
    failed: int = 0,
    errors: List[str] | None = None,
) -> dict:
    return UploadResult(uploaded=uploaded, skipped=skipped, failed=failed, errors=errors or []).model_dump()


async def run_ssh_command(session, command: str, timeout: float = 5.0) -> str:
    """在 SSH 会话中执行命令并返回输出"""
    try:
        result = await asyncio.wait_for(
            session.client.run(command, check=False),
            timeout=timeout
        )
        return result.stdout or ""
    except asyncio.TimeoutError:
        return ""
    except Exception:
        return ""


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
                # 鎺ュ彛鍚?bytes packets ...
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
            mem_kb = int(parts[5])  # RSS 鏄 6 鍒?(index 5)
            # COMMAND 鏄粠绗?11 鍒楀紑濮嬪埌琛屽熬
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


def parse_disks(df_output: str) -> List[DiskInfo]:
    """解析 df 输出并返回挂载信息"""
    disks = []
    for line in df_output.strip().splitlines():
        parts = line.split()
        if len(parts) >= 6:
            try:
                total = int(parts[1])
                used = int(parts[2])
                percent = float(parts[4].rstrip("%"))
                mount = parts[5]
                disks.append(DiskInfo(mount=mount, total=total, used=used, percent=percent))
            except (ValueError, IndexError):
                continue
    return disks


async def collect_system_overview(session) -> SystemOverview:
    """一次性采集系统监控需要的全部信息，降低前端请求次数。"""
    stat1, meminfo, cpuinfo, net1, ps_output, df_output = await asyncio.gather(
        run_ssh_command(session, "cat /proc/stat"),
        run_ssh_command(session, "cat /proc/meminfo"),
        run_ssh_command(session, "cat /proc/cpuinfo"),
        run_ssh_command(session, "cat /proc/net/dev"),
        run_ssh_command(session, "ps aux 2>/dev/null || ps -ef 2>/dev/null", timeout=5.0),
        run_ssh_command(session, "df -B1 | grep '^/'", timeout=5.0),
    )

    # 等待一次采样间隔，计算 CPU 与网络速度
    interval = 0.5
    await asyncio.sleep(interval)
    stat2, net2 = await asyncio.gather(
        run_ssh_command(session, "cat /proc/stat"),
        run_ssh_command(session, "cat /proc/net/dev"),
    )

    memory, swap = parse_memory_info(meminfo)
    cpu = parse_cpu_info(stat1, stat2, cpuinfo)
    network = parse_network_stats(net1, net2, interval)
    processes = parse_processes(ps_output)
    processes.sort(key=lambda x: x.memory_bytes, reverse=True)
    disks = parse_disks(df_output)

    return SystemOverview(
        stats=SystemStats(cpu=cpu, memory=memory, swap=swap),
        network=network,
        processes=ProcessList(processes=processes[:20]),
        disks=DiskList(disks=disks),
    )


@router.get("/stats/{session_id}", response_model=SystemStats)
async def get_system_stats(
    session_id: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> SystemStats:
    """获取远程服务器系统状态信息（CPU、内存、交换区）"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 骞惰鑾峰彇绗竴娆℃暟鎹?
    stat1, meminfo, cpuinfo = await asyncio.gather(
        run_ssh_command(session, "cat /proc/stat"),
        run_ssh_command(session, "cat /proc/meminfo"),
        run_ssh_command(session, "cat /proc/cpuinfo"),
    )

    # 等待一小段时间再次获取 CPU 统计
    interval = 0.3
    await asyncio.sleep(interval)
    stat2 = await run_ssh_command(session, "cat /proc/stat")

    # 解析数据
    memory, swap = parse_memory_info(meminfo)
    cpu = parse_cpu_info(stat1, stat2, cpuinfo)

    return SystemStats(cpu=cpu, memory=memory, swap=swap)


@router.get("/network/{session_id}", response_model=NetworkInfo)
async def get_network_stats(
    session_id: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> NetworkInfo:
    """获取远程服务器网络速度"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 获取两次网络统计
    net1 = await run_ssh_command(session, "cat /proc/net/dev")
    interval = 0.5
    await asyncio.sleep(interval)
    net2 = await run_ssh_command(session, "cat /proc/net/dev")

    return parse_network_stats(net1, net2, interval)


@router.get("/processes/{session_id}", response_model=ProcessList)
async def get_processes(
    session_id: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> ProcessList:
    """获取远程服务器进程列表"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 使用 ps 命令获取进程信息
    ps_output = await run_ssh_command(
        session,
        "ps aux 2>/dev/null || ps -ef 2>/dev/null",
        timeout=5.0
    )

    processes = parse_processes(ps_output)
    # 鎸夊唴瀛樻帓搴忓彇鍓?20
    processes.sort(key=lambda x: x.memory_bytes, reverse=True)
    return ProcessList(processes=processes[:20])


def parse_ls_output(ls_output: str, base_path: str) -> List[FileInfo]:
    """解析 ls -la 命令输出
    格式:
    drwxr-xr-x  2 root root 4096 Mar  1 12:00 dirname
    -rw-r--r--  1 root root 1234 Mar  1 12:00 filename
    """
    import datetime

    files = []
    lines = ls_output.strip().splitlines()
    current_year = datetime.datetime.now().year

    for line in lines:
        # 跳过 total 行和空行
        if not line or line.startswith("total"):
            continue
        parts = line.split(None, 8)
        if len(parts) < 9:
            continue

        try:
            permissions = parts[0]
            owner = parts[2]
            group = parts[3]
            size = int(parts[4])
            # 时间可能是 "Mar  1 12:00" 或 "Mar  1  2024"
            month_str = parts[5]
            day_str = parts[6]
            time_or_year = parts[7]

            # 解析时间
            month_map = {"Jan": 1, "Feb": 2, "Mar": 3, "Apr": 4, "May": 5, "Jun": 6,
                        "Jul": 7, "Aug": 8, "Sep": 9, "Oct": 10, "Nov": 11, "Dec": 12}
            month = month_map.get(month_str, 1)
            day = int(day_str)

            if ":" in time_or_year:
                # 格式: Mar  1 12:00 (今年)
                hour, minute = map(int, time_or_year.split(":"))
                modified = f"{current_year}/{month:02d}/{day:02d} {hour:02d}:{minute:02d}"
            else:
                # 鏍煎紡: Mar  1  2024 (寰€骞?
                year = int(time_or_year)
                modified = f"{year}/{month:02d}/{day:02d} 00:00"

            name = parts[8]

            # 璺宠繃 . 鍜?..
            if name in (".", ".."):
                continue

            is_dir = permissions.startswith("d")
            # 处理符号链接显示
            if " -> " in name:
                name = name.split(" -> ")[0]

            # 构建完整路径
            if base_path == "/":
                full_path = f"/{name}"
            else:
                full_path = f"{base_path}/{name}"

            files.append(FileInfo(
                name=name,
                path=full_path,
                is_dir=is_dir,
                size=size,
                modified=modified,
                permissions=permissions,
                owner=owner,
                group=group,
            ))
        except (ValueError, IndexError):
            continue

    # 鐩綍鍦ㄥ墠锛屾枃浠跺湪鍚庯紝鍚勮嚜鎸夊悕绉版帓搴?
    dirs = sorted([f for f in files if f.is_dir], key=lambda x: x.name.lower())
    regular_files = sorted([f for f in files if not f.is_dir], key=lambda x: x.name.lower())
    return dirs + regular_files


@router.get("/files/{session_id}", response_model=DirectoryListing)
async def list_directory(
    session_id: str,
    path: str = "/",
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> DirectoryListing:
    """列出远程服务器目录内容"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    # 规范化路径，防止路径遍历攻击
    clean_path = sanitize_shell_path(path)
    if not clean_path.startswith("/"):
        clean_path = "/" + clean_path

    # 使用 ls -la 获取目录内容
    ls_output = await run_ssh_command(
        session,
        f"ls -la '{clean_path}' 2>/dev/null",
        timeout=10.0
    )

    if not ls_output:
        raise HTTPException(status_code=404, detail="目录不存在或无权访问")

    files = parse_ls_output(ls_output, clean_path)
    return DirectoryListing(path=clean_path, files=files)


@router.get("/disks/{session_id}", response_model=DiskList)
async def get_disks(
    session_id: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> DiskList:
    """获取磁盘挂载信息"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    df_output = await run_ssh_command(session, "df -B1 | grep '^/'", timeout=5.0)

    return DiskList(disks=parse_disks(df_output))


@router.get("/overview/{session_id}", response_model=SystemOverview)
async def get_system_overview(
    session_id: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> SystemOverview:
    """一次返回系统状态、网络、进程和磁盘信息。"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    return await collect_system_overview(session)


@router.get("/file/{session_id}")
async def read_file(
    session_id: str,
    path: str,
    force: bool = False,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
) -> dict:
    """读取文件内容"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    # 检查文件大小
    size_check = await run_ssh_command(session, f"stat -c %s '{clean_path}' 2>/dev/null || echo 0")
    size = int(size_check.strip() or 0)

    if size > 1024 * 1024 and not force:
        return {"size": size, "too_large": True}

    content = await run_ssh_command(session, f"cat '{clean_path}' 2>/dev/null", timeout=30.0)
    return {"content": content, "size": size}


@router.post("/file/{session_id}")
async def write_file(
    session_id: str,
    path: str,
    payload: FileContent,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """写入文件内容"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    with tempfile.NamedTemporaryFile(mode='w', delete=False) as tmp:
        tmp.write(payload.content)
        tmp_path = tmp.name

    try:
        async with session.client.start_sftp_client() as sftp:
            await sftp.put(tmp_path, clean_path)
    finally:
        os.unlink(tmp_path)

    return {"status": "ok"}


@router.post("/upload/{session_id}")
async def upload_file(
    session_id: str,
    path: str,
    compress: bool = False,
    file: UploadFile = File(...),
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """上传文件到远程服务器"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    safe_filename = sanitize_upload_filename(file.filename)

    with tempfile.TemporaryDirectory() as tmpdir:
        local_path = ensure_within_directory(tmpdir, os.path.join(tmpdir, safe_filename))
        content = await file.read()
        with open(local_path, "wb") as f:
            f.write(content)

        errors: List[str] = []
        uploaded = 0

        try:
            if compress:
                tar_path = os.path.join(tmpdir, f"{safe_filename}.tar.gz")
                create_tar_gz(tar_path, local_path, safe_filename)

                async with session.client.start_sftp_client() as sftp:
                    await sftp.put(tar_path, f"{clean_path}/{safe_filename}.tar.gz")

                await run_ssh_command(
                    session,
                    f"cd '{clean_path}' && tar -xzf '{safe_filename}.tar.gz' && rm -f '{safe_filename}.tar.gz'",
                    timeout=30.0,
                )
                uploaded = 1
            else:
                async with session.client.start_sftp_client() as sftp:
                    await sftp.put(local_path, f"{clean_path}/{safe_filename}")
                uploaded = 1
        except Exception as exc:
            errors.append(f"{safe_filename}: {exc}")

    if errors:
        return build_upload_result(uploaded=uploaded, failed=len(errors), errors=errors)

    return build_upload_result(uploaded=uploaded)


@router.post("/upload-targz/{session_id}")
async def upload_targz(
    session_id: str,
    path: str,
    file: UploadFile = File(...),
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """上传 tar.gz 压缩包并解压"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    errors: List[str] = []
    uploaded = 0

    try:
        async with session.client.start_sftp_client() as sftp:
            await sftp.put(tmp_path, f"{clean_path}/upload.tar.gz")
        await run_ssh_command(session, f"cd '{clean_path}' && tar -xzf upload.tar.gz && rm -f upload.tar.gz", timeout=120.0)
        uploaded = 1
    except Exception as exc:
        errors.append(f"upload.tar.gz: {exc}")
    finally:
        os.unlink(tmp_path)

    if errors:
        return build_upload_result(uploaded=uploaded, failed=len(errors), errors=errors)

    return build_upload_result(uploaded=uploaded)


@router.post("/upload-zip/{session_id}")
async def upload_zip(
    session_id: str,
    path: str,
    file: UploadFile = File(...),
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """上传 zip 压缩包并解压"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    errors: List[str] = []
    uploaded = 0

    try:
        async with session.client.start_sftp_client() as sftp:
            await sftp.put(tmp_path, f"{clean_path}/upload.zip")
        await run_ssh_command(session, f"cd '{clean_path}' && unzip -q upload.zip && rm -f upload.zip", timeout=120.0)
        uploaded = 1
    except Exception as exc:
        errors.append(f"upload.zip: {exc}")
    finally:
        os.unlink(tmp_path)

    if errors:
        return build_upload_result(uploaded=uploaded, failed=len(errors), errors=errors)

    return build_upload_result(uploaded=uploaded)


@router.post("/upload-batch/{session_id}")
async def upload_batch(
    session_id: str,
    path: str,
    compress: bool = False,
    concurrent: int = 3,
    files: List[UploadFile] = File(...),
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """批量上传文件（支持文件夹结构）"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    with tempfile.TemporaryDirectory() as tmpdir:
        written_files = 0
        staged_files: List[tuple[str, str]] = []
        errors: List[str] = []

        for file in files:
            relative_path = sanitize_upload_relative_path(file.filename)
            file_path = ensure_within_directory(tmpdir, os.path.join(tmpdir, relative_path))
            os.makedirs(os.path.dirname(file_path), exist_ok=True)
            content = await file.read()
            with open(file_path, "wb") as f:
                f.write(content)

            staged_files.append((relative_path, file_path))
            written_files += 1

        if compress:
            tar_path = os.path.join(tmpdir, "upload.tar.gz")
            with tarfile.open(tar_path, "w:gz") as tar:
                for relative_path, file_path in staged_files:
                    tar.add(file_path, arcname=relative_path)

            try:
                async with session.client.start_sftp_client() as sftp:
                    await sftp.put(tar_path, f"{clean_path}/upload.tar.gz")

                await run_ssh_command(session, f"cd '{clean_path}' && tar -xzf upload.tar.gz && rm -f upload.tar.gz", timeout=60.0)
            except Exception as exc:
                errors.append(f"upload.tar.gz: {exc}")
                return build_upload_result(uploaded=0, failed=written_files, errors=errors)

            return build_upload_result(uploaded=written_files)

        uploaded = 0
        queue = list(staged_files)
        concurrency = max(1, min(concurrent, 8))
        semaphore = asyncio.Semaphore(concurrency)

        async def upload_one(relative_path: str, file_path: str) -> bool:
            remote_path = f"{clean_path}/{relative_path}"
            remote_dir = os.path.dirname(remote_path)

            try:
                async with semaphore:
                    await run_ssh_command(session, f"mkdir -p '{remote_dir}'")
                    async with session.client.start_sftp_client() as sftp:
                        await sftp.put(file_path, remote_path)
                return True
            except Exception as exc:
                errors.append(f"{relative_path}: {exc}")
                return False

        results = await asyncio.gather(*(upload_one(relative_path, file_path) for relative_path, file_path in queue))
        uploaded = sum(1 for ok in results if ok)

    failed = len(errors)
    return build_upload_result(uploaded=uploaded, failed=failed, errors=errors)


@router.post("/mkdir/{session_id}")
async def make_directory(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """创建目录"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    clean_path = sanitize_shell_path(path)
    await run_ssh_command(session, f"mkdir -p '{clean_path}'")
    return {"status": "ok"}


@router.post("/touch/{session_id}")
async def touch_file(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """创建文件"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    clean_path = sanitize_shell_path(path)
    await run_ssh_command(session, f"touch '{clean_path}'")
    return {"status": "ok"}


@router.post("/rename/{session_id}")
async def rename_file(
    session_id: str,
    old_path: str,
    new_path: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """重命名文件或目录"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    clean_old = sanitize_shell_path(old_path)
    clean_new = sanitize_shell_path(new_path)
    await run_ssh_command(session, f"mv '{clean_old}' '{clean_new}'")
    return {"status": "ok"}


@router.post("/chmod/{session_id}")
async def change_mode(
    session_id: str,
    path: str,
    mode: str,
    recursive: bool = False,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """修改文件权限"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    clean_path = sanitize_shell_path(path)
    clean_mode = sanitize_shell_path(mode)
    recursive_flag = "-R " if recursive else ""
    await run_ssh_command(session, f"chmod {recursive_flag}{clean_mode} '{clean_path}'")
    return {"status": "ok"}


@router.delete("/delete/{session_id}")
async def delete_file(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """删除文件或目录"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")
    clean_path = sanitize_shell_path(path)
    await run_ssh_command(session, f"rm -rf '{clean_path}'")
    return {"status": "ok"}


@router.get("/download/{session_id}")
async def download_file(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    _user: dict = Depends(get_current_user)
):
    """从远程服务器下载文件"""
    session = state.session_manager.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="会话不存在")

    clean_path = sanitize_shell_path(path)

    # 检查是否为目录
    check_result = await run_ssh_command(session, f"[ -d '{clean_path}' ] && echo 'dir' || echo 'file'")
    is_dir = check_result.strip() == "dir"

    filename = os.path.basename(clean_path)

    if is_dir:
        # 压缩目录
        tar_name = f"{filename}.tar.gz"
        remote_tar = f"/tmp/{tar_name}"
        await run_ssh_command(session, f"tar -czf {remote_tar} -C {os.path.dirname(clean_path)} {filename}", timeout=60.0)

        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name

        try:
            async with session.client.start_sftp_client() as sftp:
                await sftp.get(remote_tar, tmp_path)

            await run_ssh_command(session, f"rm {remote_tar}")

            with open(tmp_path, "rb") as f:
                content = f.read()

            encoded_filename = quote(tar_name)
            return StreamingResponse(
                iter([content]),
                media_type="application/gzip",
                headers={
                    "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                    "Content-Length": str(len(content)),
                },
            )
        finally:
            os.unlink(tmp_path)
    else:
        # 直接下载文件
        with tempfile.NamedTemporaryFile(delete=False) as tmp:
            tmp_path = tmp.name

        try:
            async with session.client.start_sftp_client() as sftp:
                await sftp.get(clean_path, tmp_path)

            with open(tmp_path, "rb") as f:
                content = f.read()

            encoded_filename = quote(filename)
            return StreamingResponse(
                iter([content]),
                media_type="application/octet-stream",
                headers={
                    "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}",
                    "Content-Length": str(len(content)),
                },
            )
        finally:
            os.unlink(tmp_path)

