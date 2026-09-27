"""Client-side REST wrapper — gọi /api/matches, /api/platforms/.../odds."""
import ssl
from typing import Any, Optional

import httpx

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
    async def list_matches(self, **filters):
        """Passthrough tất cả filter làm query params. Filter được support:
        tournament, sport, phase, virtual, team, has_odds, since, until, limit.
        Value None sẽ bị strip."""
        params: dict[str, Any] = {k: v for k, v in filters.items() if v is not None}
        params.setdefault("limit", 50)
        r = await self._http.get("/api/matches", params=params)
        r.raise_for_status()
        return r.json()

    async def matches_count(self, **filters):
        params: dict[str, Any] = {k: v for k, v in filters.items() if v is not None}
        r = await self._http.get("/api/matches/count", params=params)
        r.raise_for_status()
        return r.json()

    async def stats(self):
        r = await self._http.get("/api/stats")
        r.raise_for_status()
        return r.json()

    async def find(self, text: str, limit: int = 20):
        r = await self._http.get("/api/find", params={"text": text, "limit": limit})
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

    async def odds(self, platform: str, slug: str):
        r = await self._http.get(f"/api/platforms/{platform}/matches/{slug}/odds")
        r.raise_for_status()
        return r.json()

    async def close(self):
        await self._http.aclose()
