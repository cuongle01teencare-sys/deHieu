"""
Client-side wrapper:
    - REST calls tới `/api/matches...`
    - WebSocket subscribe `/events`
"""
import asyncio
import json
import ssl
from typing import Any, AsyncIterator, Optional
from urllib.parse import urlencode

import httpx
import websockets

from client.config import ServerConfig
from client.core.connection import build_ssl_context


class ApiClient:
    def __init__(self, cfg: ServerConfig):
        self.cfg = cfg
        self.ssl_ctx: Optional[ssl.SSLContext] = build_ssl_context(cfg.tls)
        self._http = httpx.AsyncClient(
            base_url=cfg.base_url,
            verify=self.ssl_ctx if self.ssl_ctx else True,
            cert=(cfg.tls.client_cert, cfg.tls.client_key) if cfg.tls else None,
            timeout=15.0,
        )

    # ---------- REST ----------
    async def list_matches(self, tournament: Optional[str] = None, limit: int = 50):
        params: dict[str, Any] = {"limit": limit}
        if tournament:
            params["tournament"] = tournament
        r = await self._http.get("/api/matches", params=params)
        r.raise_for_status()
        return r.json()

    async def get_match(self, mid: str):
        r = await self._http.get(f"/api/matches/{mid}")
        r.raise_for_status()
        return r.json()

    async def scores(self, mid: str, since: Optional[str] = None, limit: int = 500):
        params: dict[str, Any] = {"limit": limit}
        if since:
            params["since"] = since
        r = await self._http.get(f"/api/matches/{mid}/scores", params=params)
        r.raise_for_status()
        return r.json()

    async def health(self):
        r = await self._http.get("/health")
        return r.json()

    # ---------- WebSocket ----------
    async def stream(self, match_id: Optional[str] = None) -> AsyncIterator[dict]:
        url = self.cfg.ws_url
        if match_id:
            url += "?" + urlencode({"match_id": match_id})
        async with websockets.connect(url, ssl=self.ssl_ctx) as ws:
            async for msg in ws:
                try:
                    yield json.loads(msg)
                except json.JSONDecodeError:
                    continue

    async def close(self):
        await self._http.aclose()
