from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Set

from fastapi import WebSocket


@dataclass
class SessionSubscriber:
    websocket: WebSocket
    user_id: int


class SessionBroadcaster:
    def __init__(self) -> None:
        self._subscribers: Dict[str, Set[WebSocket]] = {}

    async def subscribe(self, user_id: int, websocket: WebSocket) -> None:
        key = str(user_id)
        if key not in self._subscribers:
            self._subscribers[key] = set()
        self._subscribers[key].add(websocket)

    async def unsubscribe(self, user_id: int, websocket: WebSocket) -> None:
        key = str(user_id)
        if key in self._subscribers:
            self._subscribers[key].discard(websocket)

    async def broadcast(self, user_id: int, message: str) -> None:
        key = str(user_id)
        sockets = list(self._subscribers.get(key, set()))
        for websocket in sockets:
            await websocket.send_text(message)
