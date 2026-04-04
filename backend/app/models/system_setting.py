from __future__ import annotations

from sqlalchemy import Boolean, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin


class SystemSetting(TimestampMixin, Base):
    __tablename__ = "system_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=False, default=1)
    enhanced_retry_max_attempts: Mapped[int] = mapped_column(Integer, default=5)
    enhanced_retry_schedule: Mapped[str] = mapped_column(String(255), default="2,4,8,16,32")
    session_status_refresh_interval_seconds: Mapped[int] = mapped_column(Integer, default=3)
    default_enable_enhanced_session: Mapped[bool] = mapped_column(Boolean, default=False)
