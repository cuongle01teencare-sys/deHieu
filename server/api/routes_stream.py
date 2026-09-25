"""WebSocket /events — subscribe Redis pub/sub và fanout tới clients."""
import json
import logging
from typing import Optional
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect

from server.common.redis_bus import bus, CH_SCORES, CH_MATCHES, CH_STATUS

log = logging.getLogger("api.ws")
router = APIRouter(tags=["stream"])


@router.websocket("/events")
async def events(ws: WebSocket, match_id: Optional[str] = Query(None)):
    await ws.accept()
    await ws.send_json({"type": "welcome", "filter": {"match_id": match_id}})

    try:
        async for channel, payload in bus.subscribe(CH_SCORES, CH_MATCHES, CH_STATUS):
            if match_id and payload.get("match_id") != match_id:
                continue
            try:
                await ws.send_json({"channel": channel, "data": payload})
            except (WebSocketDisconnect, RuntimeError):
                break
    except WebSocketDisconnect:
        pass
    except Exception as e:
        log.warning("ws stream error: %s", e)
    finally:
        try:
            await ws.close()
        except Exception:
            pass
