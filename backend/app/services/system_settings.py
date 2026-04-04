from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.system_setting import SystemSetting

DEFAULT_ENHANCED_RETRY_MAX_ATTEMPTS = 5
DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS = [2, 4, 8, 16, 32]
DEFAULT_SESSION_STATUS_REFRESH_INTERVAL_SECONDS = 3
DEFAULT_ENABLE_ENHANCED_SESSION = False
MAX_ENHANCED_RETRY_ATTEMPTS = 20
MAX_RETRY_DELAY_SECONDS = 3600
MAX_SESSION_STATUS_REFRESH_INTERVAL_SECONDS = 60


@dataclass(frozen=True)
class RuntimeSystemSettings:
    enhanced_retry_max_attempts: int
    enhanced_retry_schedule_seconds: list[int]
    session_status_refresh_interval_seconds: int
    default_enable_enhanced_session: bool


def default_runtime_system_settings() -> RuntimeSystemSettings:
    return RuntimeSystemSettings(
        enhanced_retry_max_attempts=DEFAULT_ENHANCED_RETRY_MAX_ATTEMPTS,
        enhanced_retry_schedule_seconds=[*DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS],
        session_status_refresh_interval_seconds=DEFAULT_SESSION_STATUS_REFRESH_INTERVAL_SECONDS,
        default_enable_enhanced_session=DEFAULT_ENABLE_ENHANCED_SESSION,
    )


def sanitize_retry_max_attempts(value: int) -> int:
    normalized = int(value)
    if normalized < 1 or normalized > MAX_ENHANCED_RETRY_ATTEMPTS:
        raise ValueError(f"增强会话自动重试次数必须在 1 到 {MAX_ENHANCED_RETRY_ATTEMPTS} 之间")
    return normalized


def sanitize_retry_schedule_seconds(values: list[int]) -> list[int]:
    if not values:
        raise ValueError("增强会话自动重试间隔不能为空")

    normalized_values: list[int] = []
    for value in values:
        normalized = int(value)
        if normalized < 1 or normalized > MAX_RETRY_DELAY_SECONDS:
            raise ValueError(f"增强会话自动重试间隔必须在 1 到 {MAX_RETRY_DELAY_SECONDS} 秒之间")
        normalized_values.append(normalized)
    return normalized_values


def sanitize_session_status_refresh_interval_seconds(value: int) -> int:
    normalized = int(value)
    if normalized < 1 or normalized > MAX_SESSION_STATUS_REFRESH_INTERVAL_SECONDS:
        raise ValueError(f"系统状态刷新间隔必须在 1 到 {MAX_SESSION_STATUS_REFRESH_INTERVAL_SECONDS} 秒之间")
    return normalized


def parse_retry_schedule(raw_value: str | None) -> list[int]:
    if not raw_value:
        return [*DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS]

    values: list[int] = []
    for part in raw_value.split(","):
        text = part.strip()
        if not text:
            continue
        try:
            values.append(int(text))
        except ValueError:
            return [*DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS]

    try:
        return sanitize_retry_schedule_seconds(values)
    except ValueError:
        return [*DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS]


def serialize_retry_schedule(values: list[int]) -> str:
    return ",".join(str(value) for value in sanitize_retry_schedule_seconds(values))


def resolve_retry_delay_seconds(retry_index: int, schedule_seconds: list[int]) -> int:
    if not schedule_seconds:
        return DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS[-1]
    index = min(max(retry_index, 0), len(schedule_seconds) - 1)
    return schedule_seconds[index]


def ensure_system_settings_record(db: Session) -> SystemSetting:
    record = db.execute(select(SystemSetting).where(SystemSetting.id == 1)).scalar_one_or_none()
    if record:
        return record

    record = SystemSetting(
        id=1,
        enhanced_retry_max_attempts=DEFAULT_ENHANCED_RETRY_MAX_ATTEMPTS,
        enhanced_retry_schedule=serialize_retry_schedule(DEFAULT_ENHANCED_RETRY_SCHEDULE_SECONDS),
        session_status_refresh_interval_seconds=DEFAULT_SESSION_STATUS_REFRESH_INTERVAL_SECONDS,
        default_enable_enhanced_session=DEFAULT_ENABLE_ENHANCED_SESSION,
    )
    db.add(record)
    db.flush()
    return record


def load_runtime_system_settings(db: Session) -> RuntimeSystemSettings:
    record = ensure_system_settings_record(db)

    try:
        enhanced_retry_max_attempts = sanitize_retry_max_attempts(record.enhanced_retry_max_attempts)
    except ValueError:
        enhanced_retry_max_attempts = DEFAULT_ENHANCED_RETRY_MAX_ATTEMPTS

    schedule_seconds = parse_retry_schedule(record.enhanced_retry_schedule)

    try:
        session_status_refresh_interval_seconds = sanitize_session_status_refresh_interval_seconds(
            record.session_status_refresh_interval_seconds
        )
    except ValueError:
        session_status_refresh_interval_seconds = DEFAULT_SESSION_STATUS_REFRESH_INTERVAL_SECONDS

    return RuntimeSystemSettings(
        enhanced_retry_max_attempts=enhanced_retry_max_attempts,
        enhanced_retry_schedule_seconds=schedule_seconds,
        session_status_refresh_interval_seconds=session_status_refresh_interval_seconds,
        default_enable_enhanced_session=bool(record.default_enable_enhanced_session),
    )
