from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import Boolean, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin, UTCDateTime


class SessionRecord(TimestampMixin, Base):
    __tablename__ = "sessions"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    connection_id: Mapped[int] = mapped_column(Integer, ForeignKey("connections.id"))
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    status: Mapped[str] = mapped_column(String(32))
    started_at: Mapped[datetime] = mapped_column(UTCDateTime())
    last_activity: Mapped[datetime] = mapped_column(UTCDateTime())
    pty_info: Mapped[str] = mapped_column(Text)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    enhanced_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    enhanced_fingerprint: Mapped[Optional[str]] = mapped_column(String(128), nullable=True)
    tmux_binary_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    disconnected_at: Mapped[Optional[datetime]] = mapped_column(UTCDateTime(), nullable=True)
    auto_retry_count: Mapped[int] = mapped_column(Integer, default=0)
    retry_cycle_count: Mapped[int] = mapped_column(Integer, default=0)
    allow_auto_retry: Mapped[bool] = mapped_column(Boolean, default=True)
