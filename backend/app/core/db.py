from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Mapped, Session, mapped_column, sessionmaker
from sqlalchemy.types import DateTime as SQLAlchemyDateTime, TypeDecorator


def utc_now() -> datetime:
    """返回当前 UTC 时间（带时区信息）"""
    return datetime.now(timezone.utc)


def ensure_utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


class UTCDateTime(TypeDecorator):
    """Store UTC datetimes and always return timezone-aware UTC values."""

    impl = SQLAlchemyDateTime
    cache_ok = True

    def load_dialect_impl(self, dialect):
        return dialect.type_descriptor(SQLAlchemyDateTime(timezone=True))

    def process_bind_param(self, value: datetime | None, dialect):
        normalized = ensure_utc(value)
        if normalized is None:
            return None
        if dialect.name == "sqlite":
            # SQLite doesn't preserve tzinfo in DATETIME columns.
            return normalized.replace(tzinfo=None)
        return normalized

    def process_result_value(self, value: datetime | None, _dialect):
        return ensure_utc(value)


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime(), default=utc_now, onupdate=utc_now)


class Database:
    def __init__(self, database_url: str) -> None:
        connect_args = {}
        if database_url.startswith("sqlite"):
            connect_args = {"check_same_thread": False}
            self._ensure_sqlite_path(database_url)
        self._engine = create_engine(database_url, connect_args=connect_args)
        self._session_factory = sessionmaker(bind=self._engine, autoflush=False, autocommit=False)

    def _ensure_sqlite_path(self, database_url: str) -> None:
        if database_url.startswith("sqlite:////"):
            path_str = database_url.replace("sqlite:////", "/")
        elif database_url.startswith("sqlite:///" ):
            path_str = database_url.replace("sqlite:///", "")
        else:
            return

        path = Path(path_str)
        if path.suffix:
            path.parent.mkdir(parents=True, exist_ok=True)
        else:
            path.mkdir(parents=True, exist_ok=True)

    def create_tables(self) -> None:
        Base.metadata.create_all(self._engine)

    @contextmanager
    def session(self) -> Generator[Session, None, None]:
        session = self._session_factory()
        try:
            yield session
            session.commit()
        except Exception:
            session.rollback()
            raise
        finally:
            session.close()

