from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, WebSocket, WebSocketDisconnect

from app.api.dependencies import AppState, get_current_user_from_ws, get_db, get_state


router = APIRouter(prefix="/sessions", tags=["sessions"])


@router.websocket("/ws/sessions/{user_id}")
async def sessions_socket(
    websocket: WebSocket,
    user_id: int,
    state: AppState = Depends(get_state),
    db=Depends(get_db),
) -> None:
    await websocket.accept()
    try:
        user = get_current_user_from_ws(websocket, state, db)
        if user.id != user_id:
            await websocket.close(code=1008)
            return

        broadcaster = state.session_broadcaster
        await broadcaster.subscribe(user_id, websocket)
        try:
            while True:
                await websocket.receive_text()
        except WebSocketDisconnect:
            return
        finally:
            await broadcaster.unsubscribe(user_id, websocket)
    except Exception as exc:
        logging.getLogger(__name__).warning("sessions_socket error: %s", exc)
        try:
            await websocket.close(code=1008)
        except Exception:
            pass
