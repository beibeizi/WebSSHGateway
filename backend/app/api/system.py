from __future__ import annotations

import asyncio
import json
import re
import tempfile
import os
import tarfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, AsyncIterator
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from sqlalchemy import select

from app.api.dependencies import AppState, get_current_user, get_state, get_db
from app.core.logging import get_logger, get_recent_logs
from app.models.connection import Connection
from app.models.session import SessionRecord
from app.services.crypto import CryptoService, EncryptedPayload
from app.schemas.system_metrics import (
    DiskList, NetworkInfo, ProcessList, SystemOverview, SystemStats,
)
from app.services.system_metrics import (
    collect_disks, collect_network_stats, collect_processes,
    collect_system_overview, collect_system_stats, run_ssh_command,
)

router = APIRouter(prefix="/system", tags=["system"])
logger = get_logger(__name__)


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


class FileContent(BaseModel):
    content: str


class SystemLogEntry(BaseModel):
    sequence: int
    timestamp: str
    level: str
    logger: str
    request_id: str
    message: str
    line: str


class SystemLogList(BaseModel):
    entries: List[SystemLogEntry]
    limit: int
    level: str | None = None


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


@asynccontextmanager
async def resolve_ssh_client(
    session_id: str,
    state: AppState,
    user,
    db,
) -> AsyncIterator:
    record = db.execute(
        select(SessionRecord).where(SessionRecord.id == session_id, SessionRecord.user_id == user.id)
    ).scalar_one_or_none()
    if not record or record.status != "active":
        raise HTTPException(status_code=404, detail="会话不存在")

    conn = db.execute(
        select(Connection).where(Connection.id == record.connection_id, Connection.user_id == user.id)
    ).scalar_one_or_none()
    if not conn:
        raise HTTPException(status_code=404, detail="连接不存在")

    crypto = CryptoService(state.config.secret_keys)
    auth_data = json.loads(conn.auth_data)
    decrypted = crypto.decrypt(EncryptedPayload(nonce=auth_data["nonce"], ciphertext=auth_data["ciphertext"]))
    auth_payload = json.loads(decrypted)

    # System/file APIs must not reuse the terminal session SSH client.
    # Long-lived enhanced sessions may keep the tmux PTY channel alive while
    # auxiliary exec channels on the same client become unusable.
    client = await state.session_manager.connect_client(conn, auth_payload)
    try:
        yield client
    finally:
        client.close()
        await client.wait_closed()


@router.get("/logs", response_model=SystemLogList)
def get_system_logs(
    limit: int = Query(default=200, ge=1, le=1000),
    level: str | None = Query(default=None, max_length=20),
    _user=Depends(get_current_user),
) -> SystemLogList:
    normalized_level = level.upper() if level else None
    if normalized_level and normalized_level not in {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}:
        raise HTTPException(status_code=400, detail="无效的日志级别")
    return SystemLogList(
        entries=get_recent_logs(limit=limit, level=normalized_level),
        limit=limit,
        level=normalized_level,
    )


@router.get("/stats/{session_id}", response_model=SystemStats)
async def get_system_stats(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SystemStats:
    """获取远程服务器系统状态信息（CPU、内存、交换区）"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        return await collect_system_stats(client)


@router.get("/network/{session_id}", response_model=NetworkInfo)
async def get_network_stats(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> NetworkInfo:
    """获取远程服务器网络速度"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        return await collect_network_stats(client)


@router.get("/processes/{session_id}", response_model=ProcessList)
async def get_processes(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> ProcessList:
    """获取远程服务器进程列表"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        return await collect_processes(client)


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
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> DirectoryListing:
    """列出远程服务器目录内容"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)
        if not clean_path.startswith("/"):
            clean_path = "/" + clean_path

        ls_output = await run_ssh_command(
            client,
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
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> DiskList:
    """获取磁盘挂载信息"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        return await collect_disks(client)


@router.get("/overview/{session_id}", response_model=SystemOverview)
async def get_system_overview(
    session_id: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SystemOverview:
    """一次返回系统状态、网络、进程和磁盘信息。"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        return await collect_system_overview(client)


@router.get("/file/{session_id}")
async def read_file(
    session_id: str,
    path: str,
    force: bool = False,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> dict:
    """读取文件内容"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)

        size_check = await run_ssh_command(
            client,
            f"stat -c %s '{clean_path}' 2>/dev/null || stat -f %z '{clean_path}' 2>/dev/null || echo 0",
        )
        size = int(size_check.strip() or 0)

        if size > 1024 * 1024 and not force:
            return {"size": size, "too_large": True}

        content = await run_ssh_command(client, f"cat '{clean_path}' 2>/dev/null", timeout=30.0)
        return {"content": content, "size": size}


@router.post("/file/{session_id}")
async def write_file(
    session_id: str,
    path: str,
    payload: FileContent,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """写入文件内容"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)

        with tempfile.NamedTemporaryFile(mode='w', delete=False) as tmp:
            tmp.write(payload.content)
            tmp_path = tmp.name

        try:
            async with client.start_sftp_client() as sftp:
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
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """上传文件到远程服务器"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
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

                    async with client.start_sftp_client() as sftp:
                        await sftp.put(tar_path, f"{clean_path}/{safe_filename}.tar.gz")

                    await run_ssh_command(
                        client,
                        f"cd '{clean_path}' && tar -xzf '{safe_filename}.tar.gz' && rm -f '{safe_filename}.tar.gz'",
                        timeout=30.0,
                    )
                    uploaded = 1
                else:
                    async with client.start_sftp_client() as sftp:
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
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """上传 tar.gz 压缩包并解压"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)

        with tempfile.NamedTemporaryFile(suffix=".tar.gz", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        errors: List[str] = []
        uploaded = 0

        try:
            async with client.start_sftp_client() as sftp:
                await sftp.put(tmp_path, f"{clean_path}/upload.tar.gz")
            await run_ssh_command(client, f"cd '{clean_path}' && tar -xzf upload.tar.gz && rm -f upload.tar.gz", timeout=120.0)
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
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """上传 zip 压缩包并解压"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)

        with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as tmp:
            content = await file.read()
            tmp.write(content)
            tmp_path = tmp.name

        errors: List[str] = []
        uploaded = 0

        try:
            async with client.start_sftp_client() as sftp:
                await sftp.put(tmp_path, f"{clean_path}/upload.zip")
            await run_ssh_command(client, f"cd '{clean_path}' && unzip -q upload.zip && rm -f upload.zip", timeout=120.0)
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
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """批量上传文件（支持文件夹结构）"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
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
                    async with client.start_sftp_client() as sftp:
                        await sftp.put(tar_path, f"{clean_path}/upload.tar.gz")

                    await run_ssh_command(client, f"cd '{clean_path}' && tar -xzf upload.tar.gz && rm -f upload.tar.gz", timeout=60.0)
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
                        await run_ssh_command(client, f"mkdir -p '{remote_dir}'")
                        async with client.start_sftp_client() as sftp:
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
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """创建目录"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)
        await run_ssh_command(client, f"mkdir -p '{clean_path}'")
        return {"status": "ok"}


@router.post("/touch/{session_id}")
async def touch_file(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """创建文件"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)
        await run_ssh_command(client, f"touch '{clean_path}'")
        return {"status": "ok"}


@router.post("/rename/{session_id}")
async def rename_file(
    session_id: str,
    old_path: str,
    new_path: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """重命名文件或目录"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_old = sanitize_shell_path(old_path)
        clean_new = sanitize_shell_path(new_path)
        await run_ssh_command(client, f"mv '{clean_old}' '{clean_new}'")
        return {"status": "ok"}


@router.post("/chmod/{session_id}")
async def change_mode(
    session_id: str,
    path: str,
    mode: str,
    recursive: bool = False,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """修改文件权限"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)
        clean_mode = sanitize_shell_path(mode)
        recursive_flag = "-R " if recursive else ""
        await run_ssh_command(client, f"chmod {recursive_flag}{clean_mode} '{clean_path}'")
        return {"status": "ok"}


@router.delete("/delete/{session_id}")
async def delete_file(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """删除文件或目录"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)
        await run_ssh_command(client, f"rm -rf '{clean_path}'")
        return {"status": "ok"}


@router.get("/download/{session_id}")
async def download_file(
    session_id: str,
    path: str,
    state: AppState = Depends(get_state),
    user=Depends(get_current_user),
    db=Depends(get_db),
):
    """从远程服务器下载文件"""
    async with resolve_ssh_client(session_id, state, user, db) as client:
        clean_path = sanitize_shell_path(path)

        check_result = await run_ssh_command(client, f"[ -d '{clean_path}' ] && echo 'dir' || echo 'file'")
        is_dir = check_result.strip() == "dir"

        filename = os.path.basename(clean_path)

        if is_dir:
            tar_name = f"{filename}.tar.gz"
            remote_tar = f"/tmp/{tar_name}"
            await run_ssh_command(client, f"tar -czf {remote_tar} -C {os.path.dirname(clean_path)} {filename}", timeout=60.0)

            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp_path = tmp.name

            try:
                async with client.start_sftp_client() as sftp:
                    await sftp.get(remote_tar, tmp_path)

                await run_ssh_command(client, f"rm {remote_tar}")

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
            with tempfile.NamedTemporaryFile(delete=False) as tmp:
                tmp_path = tmp.name

            try:
                async with client.start_sftp_client() as sftp:
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
