from __future__ import annotations

import argparse
import getpass
import sys
from pathlib import Path
from typing import Sequence

from dotenv import load_dotenv
from sqlalchemy import select

from app.core.config import load_config
from app.core.db import Database
from app.models.user import User
from app.services.auth import AuthService


def load_cli_env() -> None:
    project_root = Path(__file__).resolve().parents[2]
    env_file = project_root / ".env"
    load_dotenv(env_file if env_file.exists() else None)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="WebSSH Gateway 管理命令")
    subparsers = parser.add_subparsers(dest="command", required=True)

    reset_parser = subparsers.add_parser("reset-password", help="重置指定用户密码")
    reset_parser.add_argument("--username", required=True, help="要重置密码的用户名")
    reset_parser.add_argument(
        "--password-stdin",
        action="store_true",
        help="从标准输入读取新密码，适用于自动化场景",
    )
    return parser


def read_new_password(password_stdin: bool) -> str:
    if password_stdin:
        password = sys.stdin.read().strip()
        if not password:
            raise ValueError("标准输入中未读取到新密码")
        return password

    password = getpass.getpass("请输入新密码: ").strip()
    confirm_password = getpass.getpass("请再次输入新密码: ").strip()
    if password != confirm_password:
        raise ValueError("两次输入的新密码不一致")
    if not password:
        raise ValueError("新密码不能为空")
    return password


def reset_password(username: str, password_stdin: bool) -> None:
    load_cli_env()
    config = load_config()
    database = Database(config.database_url)
    auth_service = AuthService(config)

    new_password = read_new_password(password_stdin)
    auth_service.validate_new_password(username, new_password)

    with database.session() as session:
        user = session.execute(select(User).where(User.username == username.strip())).scalar_one_or_none()
        if not user:
            raise LookupError(f"用户不存在：{username}")

        user.password_hash = auth_service.hash_password(new_password)
        user.must_change_password = True
        auth_service.clear_lock_state(user)


def main(argv: Sequence[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)

    try:
        if args.command == "reset-password":
            reset_password(args.username, args.password_stdin)
            print(f"用户 {args.username} 的密码已重置，并将在下次登录时强制修改密码。")
            return 0
    except (LookupError, RuntimeError, ValueError) as exc:
        print(str(exc), file=sys.stderr)
        return 1

    parser.print_help(sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
