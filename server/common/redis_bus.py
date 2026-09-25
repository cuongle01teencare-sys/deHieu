"""Redis Pub/Sub wrapper (scaffold — chỉ publish/subscribe cơ bản)."""
import json
from typing import AsyncIterator, Optional
import redis.asyncio as aioredis

from server.common.config import settings


# Channel names — dùng ở poller (publish) và api (subscribe)
CH_SCORES = "scores.updated"
CH_MATCHES = "matches.new"
CH_MATCH_ENDED = "matches.ended"
CH_STATUS = "poller.status"


class RedisBus:
    def __init__(self, url: Optional[str] = None):
        self.url = url or settings.redis_url
        self._client: Optional[aioredis.Redis] = None

    def _require(self) -> aioredis.Redis:
        """Trả client sau khi assert đã connect (giúp Pylance narrow Optional)."""
        if self._client is None:
            raise RuntimeError("RedisBus chưa connect() — gọi await bus.connect() trước")
        return self._client

    async def connect(self):
        self._client = aioredis.from_url(self.url, decode_responses=True)
        await self._client.ping()

    async def close(self):
        if self._client is not None:
            await self._client.aclose()
            self._client = None

    async def publish(self, channel: str, payload: dict):
        await self._require().publish(channel, json.dumps(payload, default=str))

    async def subscribe(self, *channels: str) -> AsyncIterator[tuple[str, dict]]:
        ps = self._require().pubsub()
        await ps.subscribe(*channels)
        try:
            async for msg in ps.listen():
                if msg["type"] != "message":
                    continue
                try:
                    data = json.loads(msg["data"])
                except json.JSONDecodeError:
                    data = {"raw": msg["data"]}
                yield msg["channel"], data
        finally:
            await ps.unsubscribe(*channels)
            await ps.aclose()


bus = RedisBus()
