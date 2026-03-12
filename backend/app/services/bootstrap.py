from __future__ import annotations

from datetime import datetime
import secrets
from typing import Optional

from sqlalchemy import inspect, select, text
from sqlalchemy.orm import Session

from app.core.config import AppConfig
from app.core.db import Database
from app.models.user import User
from app.services.auth import AuthService


def _generate_initial_password() -> str:
    alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+"
    while True:
        password = "".join(secrets.choice(alphabet) for _ in range(12))
        if (
            any(char.islower() for char in password)
            and any(char.isupper() for char in password)
            and any(char.isdigit() for char in password)
            and any(char in "!@#$%^&*()_+" for char in password)
        ):
            return password


def ensure_admin_user(session: Session, auth_service: AuthService) -> Optional[str]:
    existing = session.execute(select(User).where(User.username == "admin")).scalar_one_or_none()
    if existing:
        return None

    password = _generate_initial_password()
    admin = User(
        username="admin",
        password_hash=auth_service.hash_password(password),
        must_change_password=True,
        failed_login_count=0,
        locked_until=None,
        last_login=None,
    )
    session.add(admin)
    return password


def ensure_session_note_column(database: Database) -> None:
    inspector = inspect(database._engine)
    if "sessions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("sessions")}
    if "note" in columns:
        return

    with database._engine.begin() as connection:
        connection.execute(text("ALTER TABLE sessions ADD COLUMN note TEXT"))


def ensure_connection_arch_columns(database: Database) -> None:
    inspector = inspect(database._engine)
    if "connections" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("connections")}

    with database._engine.begin() as connection:
        if "remote_arch" not in columns:
            connection.execute(text("ALTER TABLE connections ADD COLUMN remote_arch VARCHAR(64)"))
        if "remote_os" not in columns:
            connection.execute(text("ALTER TABLE connections ADD COLUMN remote_os VARCHAR(64)"))
        if "enhance_prompt_shown" not in columns:
            connection.execute(text("ALTER TABLE connections ADD COLUMN enhance_prompt_shown BOOLEAN DEFAULT 0"))


def ensure_session_enhanced_columns(database: Database) -> None:
    inspector = inspect(database._engine)
    if "sessions" not in inspector.get_table_names():
        return
    columns = {column["name"] for column in inspector.get_columns("sessions")}

    with database._engine.begin() as connection:
        if "enhanced_enabled" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN enhanced_enabled BOOLEAN DEFAULT 0"))
        if "enhanced_fingerprint" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN enhanced_fingerprint VARCHAR(128)"))
        if "tmux_binary_path" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN tmux_binary_path VARCHAR(255)"))
        if "disconnected_at" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN disconnected_at DATETIME"))
        if "auto_retry_count" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN auto_retry_count INTEGER DEFAULT 0"))
        if "retry_cycle_count" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN retry_cycle_count INTEGER DEFAULT 0"))
        if "allow_auto_retry" not in columns:
            connection.execute(text("ALTER TABLE sessions ADD COLUMN allow_auto_retry BOOLEAN DEFAULT 1"))


def is_user_locked(user: User, auth_service: AuthService) -> bool:
    return auth_service.is_locked(user)


def lockout_until(user: User, config: AppConfig) -> Optional[datetime]:
    if user.locked_until is None:
        return None
    return user.locked_until
