"""REST endpoints — đọc lịch sử từ TimescaleDB."""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from server.common.db import db
from server.common.models import MatchDTO, ScoreEventDTO

router = APIRouter(prefix="/api", tags=["query"])


@router.get("/matches", response_model=list[MatchDTO])
async def list_matches(
    tournament: Optional[str] = Query(None),
    limit: int = Query(50, ge=1, le=500),
):
    rows = await db.list_matches(tournament=tournament, limit=limit)
    return [MatchDTO(**r) for r in rows]


@router.get("/matches/{match_id}", response_model=MatchDTO)
async def get_match(match_id: str):
    r = await db.get_match(match_id)
    if not r:
        raise HTTPException(404, "match not found")
    return MatchDTO(**r)


@router.get("/matches/{match_id}/scores", response_model=list[ScoreEventDTO])
async def match_scores(
    match_id: str,
    since: Optional[str] = Query(None, description="ISO timestamp"),
    limit: int = Query(500, ge=1, le=5000),
):
    rows = await db.scores_of(match_id, since_iso=since, limit=limit)
    return [ScoreEventDTO(**r) for r in rows]
