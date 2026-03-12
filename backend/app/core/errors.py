from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from fastapi import WebSocket


@dataclass
class ToolError(Exception):
    status_code: int
    message: str


def to_error_payload(error: ToolError) -> dict[str, Any]:
    return {"detail": error.message}


async def send_json(websocket: WebSocket, payload: Any) -> None:
    await websocket.send_text(json.dumps(payload))
