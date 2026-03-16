from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str
    remember_me: bool = False


class LoginResponse(BaseModel):
    access_token: str
    expires_at: datetime
    force_password_change: bool


class PasswordChangeRequest(BaseModel):
    current_password: str
    new_password: str
    confirm_password: str


class PasswordResetRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)


class PasswordResetConfirmRequest(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    verification_code: str = Field(min_length=1, max_length=32)


class PasswordResetRequestResponse(BaseModel):
    status: str
    expires_in_seconds: int


class StatusResponse(BaseModel):
    status: str


class ConnectionCreateRequest(BaseModel):
    name: str
    host: str
    port: int = 22
    username: str
    auth_type: str = Field(pattern="^(password|private_key)$")
    password: Optional[str] = None
    private_key: Optional[str] = None
    key_passphrase: Optional[str] = None
    timeout_seconds: Optional[int] = None


class ConnectionUpdateRequest(BaseModel):
    name: Optional[str] = None
    host: Optional[str] = None
    port: Optional[int] = None
    username: Optional[str] = None
    auth_type: Optional[str] = Field(default=None, pattern="^(password|private_key)$")
    password: Optional[str] = None
    private_key: Optional[str] = None
    key_passphrase: Optional[str] = None


class ConnectionResponse(BaseModel):
    id: int
    name: str
    host: str
    port: int
    username: str
    auth_type: str
    created_at: datetime
    updated_at: datetime


class SessionCreateRequest(BaseModel):
    connection_id: int
    term: str = "xterm-256color"
    rows: int = 24
    cols: int = 80
    enable_enhanced_persistence: bool = False


class SessionResponse(BaseModel):
    id: str
    connection_id: int
    status: str
    started_at: datetime
    last_activity: datetime
    host: str
    username: str
    name: str
    note: Optional[str] = None
    session_order: int = 0
    enhanced_enabled: bool = False
    remote_arch: Optional[str] = None
    remote_os: Optional[str] = None
    disconnected_at: Optional[datetime] = None
    auto_retry_count: int = 0
    retry_cycle_count: int = 0
    allow_auto_retry: bool = True
    target_profile: str = "unknown"
    target_rtt_ms: Optional[int] = None
    target_avg_rtt_ms: Optional[int] = None
    target_jitter_ms: int = 0
    target_probe_error_streak: int = 0
    target_measured_at: Optional[datetime] = None


class SessionStatusResponse(BaseModel):
    id: str
    status: str
    last_activity: datetime


class SessionNoteUpdateRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)


class SessionOrderUpdateRequest(BaseModel):
    ordered_ids: list[str] = Field(default_factory=list)


class TerminalMessage(BaseModel):
    type: str
    data: Optional[str] = None
    rows: Optional[int] = None
    cols: Optional[int] = None
