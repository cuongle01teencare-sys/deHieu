"""FastAPI app: REST /matches + /odds. Không có WS/pub-sub (đã bỏ Redis)."""
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI

from server.common.db import db
from server.api.routes_query import router as query_router
from server.api.routes_odds import router as odds_router

log = logging.getLogger("api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.connect()
    log.info("API up. DB connected.")
    yield
    await db.close()


app = FastAPI(title="deHieu API", version="0.3.0", lifespan=lifespan)
app.include_router(query_router)
app.include_router(odds_router)


@app.get("/health")
async def health():
    return {"status": "ok"}
