from __future__ import annotations

from sqlalchemy import Boolean, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.db import Base, TimestampMixin


class Connection(TimestampMixin, Base):
    __tablename__ = "connections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"))
    name: Mapped[str] = mapped_column(String(128))
    host: Mapped[str] = mapped_column(String(255))
    port: Mapped[int] = mapped_column(Integer, default=22)
    username: Mapped[str] = mapped_column(String(128))
    auth_type: Mapped[str] = mapped_column(String(32))
    auth_data: Mapped[str] = mapped_column(String(4096))
    remote_arch: Mapped[str | None] = mapped_column(String(64), nullable=True)
    remote_os: Mapped[str | None] = mapped_column(String(64), nullable=True)
    enhance_prompt_shown: Mapped[bool] = mapped_column(Boolean, default=False)
