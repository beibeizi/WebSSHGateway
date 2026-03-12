from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
import re
import secrets
import string
from threading import Lock
from typing import Iterable

import bcrypt
import jwt

from app.core.config import AppConfig
from app.core.db import utc_now
from app.models.user import User


PASSWORD_REGEX = re.compile(r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$")


@dataclass(frozen=True)
class TokenPair:
    access_token: str
    expires_at: datetime


@dataclass(frozen=True)
class PasswordResetChallenge:
    code: str
    expires_at: datetime
    attempts_remaining: int


class AuthService:
    def __init__(self, config: AppConfig) -> None:
        self._config = config
        self._password_reset_lock = Lock()
        self._password_reset_ttl = timedelta(minutes=5)
        self._password_reset_attempt_limit = 5
        self._password_reset_challenges: dict[str, PasswordResetChallenge] = {}

    def hash_password(self, password: str) -> str:
        salt = bcrypt.gensalt()
        return bcrypt.hashpw(password.encode("utf-8"), salt).decode("utf-8")

    def verify_password(self, password: str, password_hash: str) -> bool:
        return bcrypt.checkpw(password.encode("utf-8"), password_hash.encode("utf-8"))

    def validate_new_password(self, username: str, new_password: str) -> None:
        if not PASSWORD_REGEX.match(new_password):
            raise ValueError("Password must be 8+ chars with upper/lowercase and number")
        if username.lower() in new_password.lower():
            raise ValueError("Password must not contain username")

    def issue_token(self, user: User, remember: bool) -> TokenPair:
        ttl = self._config.jwt_remember_ttl if remember else self._config.jwt_access_ttl
        expires_at = utc_now() + ttl
        payload = {
            "sub": str(user.id),
            "username": user.username,
            "exp": int(expires_at.timestamp()),
            "iss": self._config.jwt_issuer,
        }
        token = jwt.encode(payload, self._config.secret_keys[0], algorithm="HS256")
        return TokenPair(access_token=token, expires_at=expires_at)

    def decode_token(self, token: str) -> dict:
        last_error: Exception | None = None
        for key in self._config.secret_keys:
            try:
                return jwt.decode(token, key, algorithms=["HS256"], issuer=self._config.jwt_issuer)
            except Exception as exc:
                last_error = exc
        raise last_error or ValueError("Invalid token")

    def is_locked(self, user: User) -> bool:
        if user.locked_until is None:
            return False
        return user.locked_until > utc_now()

    def register_failed_login(self, user: User) -> None:
        user.failed_login_count += 1
        if user.failed_login_count >= self._config.login_lock_threshold:
            user.locked_until = utc_now() + timedelta(minutes=self._config.login_lock_minutes)

    def clear_login_failures(self, user: User) -> None:
        user.failed_login_count = 0
        user.locked_until = None
        user.last_login = utc_now()

    def clear_lock_state(self, user: User) -> None:
        user.failed_login_count = 0
        user.locked_until = None

    def generate_random_password(self, length: int = 12) -> str:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*()_+"
        while True:
            password = "".join(secrets.choice(alphabet) for _ in range(length))
            if (
                any(char.islower() for char in password)
                and any(char.isupper() for char in password)
                and any(char.isdigit() for char in password)
            ):
                return password

    def create_password_reset_challenge(self, username: str) -> PasswordResetChallenge:
        normalized_username = username.strip().lower()
        challenge = PasswordResetChallenge(
            code="".join(secrets.choice(string.digits) for _ in range(6)),
            expires_at=utc_now() + self._password_reset_ttl,
            attempts_remaining=self._password_reset_attempt_limit,
        )
        with self._password_reset_lock:
            self._cleanup_expired_password_reset_challenges()
            self._password_reset_challenges[normalized_username] = challenge
        return challenge

    def verify_password_reset_challenge(self, username: str, code: str) -> None:
        normalized_username = username.strip().lower()
        normalized_code = code.strip()
        with self._password_reset_lock:
            self._cleanup_expired_password_reset_challenges()
            challenge = self._password_reset_challenges.get(normalized_username)
            if challenge is None:
                raise ValueError("校验码错误或已过期")
            if challenge.code != normalized_code:
                remaining_attempts = challenge.attempts_remaining - 1
                if remaining_attempts <= 0:
                    self._password_reset_challenges.pop(normalized_username, None)
                else:
                    self._password_reset_challenges[normalized_username] = PasswordResetChallenge(
                        code=challenge.code,
                        expires_at=challenge.expires_at,
                        attempts_remaining=remaining_attempts,
                    )
                raise ValueError("校验码错误或已过期")
            self._password_reset_challenges.pop(normalized_username, None)

    def _cleanup_expired_password_reset_challenges(self) -> None:
        now = utc_now()
        expired_usernames = [
            username
            for username, challenge in self._password_reset_challenges.items()
            if challenge.expires_at <= now
        ]
        for username in expired_usernames:
            self._password_reset_challenges.pop(username, None)
