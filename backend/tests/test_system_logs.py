from __future__ import annotations

import logging

from app.core.logging import get_recent_logs, setup_logging


def test_recent_logs_capture_formatted_records() -> None:
    setup_logging("INFO")
    logger = logging.getLogger("tests.system_logs")

    logger.info("diagnostic message")

    entries = get_recent_logs(limit=10)
    assert entries
    latest = entries[-1]
    assert latest["level"] == "INFO"
    assert latest["logger"] == "tests.system_logs"
    assert latest["message"] == "diagnostic message"
    assert "diagnostic message" in latest["line"]


def test_recent_logs_support_limit_and_level_filter() -> None:
    setup_logging("INFO")
    logger = logging.getLogger("tests.system_logs.filter")

    logger.info("visible info")
    logger.warning("visible warning")

    warning_entries = get_recent_logs(limit=1, level="WARNING")
    assert len(warning_entries) == 1
    assert warning_entries[0]["level"] == "WARNING"
    assert warning_entries[0]["message"] == "visible warning"
