from pydantic import BaseModel
from typing import List


class MemoryInfo(BaseModel):
    total: int  # 总量 bytes
    used: int   # 已用 bytes
    percent: float  # 使用率百分比


class SwapInfo(BaseModel):
    total: int
    used: int
    percent: float


class CpuInfo(BaseModel):
    percent: float  # CPU 使用率百分比
    count: int      # 逻辑核心数


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
