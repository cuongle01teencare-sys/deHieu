"""FastAPI app: REST /matches + WS /events."""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

from server.common.db import db
from server.common.redis_bus import bus
from server.api.routes_query import router as query_router
from server.api.routes_stream import router as stream_router

log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    await bus.connect()
    log.info("API up. DB + Redis connected.")
    yield
    await bus.close()
    await db.close()


app = FastAPI(title="deHieu API", version="0.3.0", lifespan=lifespan)
app.include_router(query_router)
app.include_router(stream_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
