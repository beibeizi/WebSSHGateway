from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path
import os


@dataclass(frozen=True)
class AppConfig:
    secret_keys: list[bytes]
    database_url: str
    jwt_issuer: str
    jwt_access_ttl: timedelta
    jwt_remember_ttl: timedelta
    login_lock_minutes: int
    login_lock_threshold: int
    session_keepalive_interval: int
    log_level: str
    port: int
    ssh_known_hosts: str | None
    ssh_allow_unknown_hosts: bool
    ssh_auto_add_known_hosts: bool
    cors_allow_origins: list[str]
    keepalive_binary_dir: str


def load_config() -> AppConfig:
    secret_value = os.getenv("SECRET_KEY", "")
    secret_keys = [key.strip().encode("utf-8") for key in secret_value.split(",") if key.strip()]
    if not secret_keys:
        raise RuntimeError("SECRET_KEY is required")

    if any(len(key) not in {16, 24, 32} for key in secret_keys):
        raise RuntimeError("SECRET_KEY must be 16/24/32 bytes; suggest using 32 chars")

    database_url = os.getenv("DATABASE_URL", "sqlite:////data/app.db")
    jwt_issuer = os.getenv("JWT_ISSUER", "webssh-gateway")
    jwt_access_ttl = timedelta(hours=int(os.getenv("JWT_ACCESS_TTL_HOURS", "12")))
    jwt_remember_ttl = timedelta(days=int(os.getenv("JWT_REMEMBER_TTL_DAYS", "7")))
    login_lock_minutes = int(os.getenv("LOGIN_LOCK_MINUTES", "15"))
    login_lock_threshold = int(os.getenv("LOGIN_LOCK_THRESHOLD", "5"))
    session_keepalive_interval = int(os.getenv("SESSION_KEEPALIVE_INTERVAL", "60"))
    log_level = os.getenv("LOG_LEVEL", "INFO")
    port = int(os.getenv("PORT", "8080"))
    ssh_known_hosts = os.getenv("SSH_KNOWN_HOSTS")
    ssh_allow_unknown_hosts = os.getenv("SSH_ALLOW_UNKNOWN_HOSTS", "false").lower() == "true"
    ssh_auto_add_known_hosts = os.getenv("SSH_AUTO_ADD_KNOWN_HOSTS", "true").lower() == "true"
    cors_allow_origins = [origin.strip() for origin in os.getenv("CORS_ALLOW_ORIGINS", "").split(",") if origin.strip()]
    keepalive_binary_dir = os.getenv(
        "KEEPALIVE_BINARY_DIR",
        str((Path(__file__).resolve().parents[3] / "session-transfer-files" / "tmux").resolve()),
    )

    return AppConfig(
        secret_keys=secret_keys,
        database_url=database_url,
        jwt_issuer=jwt_issuer,
        jwt_access_ttl=jwt_access_ttl,
        jwt_remember_ttl=jwt_remember_ttl,
        login_lock_minutes=login_lock_minutes,
        login_lock_threshold=login_lock_threshold,
        session_keepalive_interval=session_keepalive_interval,
        log_level=log_level,
        port=port,
        ssh_known_hosts=ssh_known_hosts,
        ssh_allow_unknown_hosts=ssh_allow_unknown_hosts,
        ssh_auto_add_known_hosts=ssh_auto_add_known_hosts,
        cors_allow_origins=cors_allow_origins,
        keepalive_binary_dir=keepalive_binary_dir,
    )
