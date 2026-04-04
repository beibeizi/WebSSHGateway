from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field, field_validator

from app.api.dependencies import get_current_user, get_db
from app.services.system_settings import (
    ensure_system_settings_record,
    load_runtime_system_settings,
    sanitize_retry_max_attempts,
    sanitize_retry_schedule_seconds,
    sanitize_session_status_refresh_interval_seconds,
    serialize_retry_schedule,
)


router = APIRouter(prefix="/system", tags=["system"])


class SystemSettingsResponse(BaseModel):
    enhanced_retry_max_attempts: int
    enhanced_retry_schedule_seconds: list[int]
    session_status_refresh_interval_seconds: int
    default_enable_enhanced_session: bool


class SystemSettingsUpdateRequest(BaseModel):
    enhanced_retry_max_attempts: int = Field(..., ge=1)
    enhanced_retry_schedule_seconds: list[int] = Field(default_factory=list, min_length=1)
    session_status_refresh_interval_seconds: int = Field(..., ge=1)
    default_enable_enhanced_session: bool

    @field_validator("enhanced_retry_max_attempts")
    @classmethod
    def _validate_retry_attempts(cls, value: int) -> int:
        return sanitize_retry_max_attempts(value)

    @field_validator("enhanced_retry_schedule_seconds")
    @classmethod
    def _validate_retry_schedule(cls, value: list[int]) -> list[int]:
        return sanitize_retry_schedule_seconds(value)

    @field_validator("session_status_refresh_interval_seconds")
    @classmethod
    def _validate_refresh_interval(cls, value: int) -> int:
        return sanitize_session_status_refresh_interval_seconds(value)


def _build_response(db) -> SystemSettingsResponse:
    settings = load_runtime_system_settings(db)
    return SystemSettingsResponse(
        enhanced_retry_max_attempts=settings.enhanced_retry_max_attempts,
        enhanced_retry_schedule_seconds=settings.enhanced_retry_schedule_seconds,
        session_status_refresh_interval_seconds=settings.session_status_refresh_interval_seconds,
        default_enable_enhanced_session=settings.default_enable_enhanced_session,
    )


@router.get("/settings", response_model=SystemSettingsResponse)
def get_system_settings(
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SystemSettingsResponse:
    return _build_response(db)


@router.put("/settings", response_model=SystemSettingsResponse)
def update_system_settings(
    payload: SystemSettingsUpdateRequest,
    user=Depends(get_current_user),
    db=Depends(get_db),
) -> SystemSettingsResponse:
    record = ensure_system_settings_record(db)
    record.enhanced_retry_max_attempts = payload.enhanced_retry_max_attempts
    record.enhanced_retry_schedule = serialize_retry_schedule(payload.enhanced_retry_schedule_seconds)
    record.session_status_refresh_interval_seconds = payload.session_status_refresh_interval_seconds
    record.default_enable_enhanced_session = payload.default_enable_enhanced_session
    return _build_response(db)
