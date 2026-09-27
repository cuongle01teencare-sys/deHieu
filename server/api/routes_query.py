"""REST endpoints — đọc lịch sử từ TimescaleDB."""
from typing import Optional
from fastapi import APIRouter, HTTPException, Query

from server.common.db import db
from server.common.models import MatchDTO, ScoreEventDTO

router = APIRouter(prefix="/api", tags=["query"])


@router.get("/matches", response_model=list[MatchDTO])
async def list_matches(
    tournament: Optional[str] = Query(None, description="ID hoặc tên tournament"),
    sport: Optional[str] = Query(None, description="ID / slug / tên sport"),
    phase: Optional[str] = Query(None, regex="^(live|prematch|ended|active|unknown)$"),
    virtual: Optional[bool] = Query(None),
    team: Optional[str] = Query(None, description="ILIKE trên home/away name"),
    has_odds: Optional[bool] = Query(None, description="Chỉ trận có odds"),
    since: Optional[str] = Query(None, description="ISO timestamp — scheduled >= X"),
    until: Optional[str] = Query(None, description="ISO timestamp — scheduled <= X"),
    limit: int = Query(50, ge=1, le=500),
):
    rows = await db.list_matches(
        tournament=tournament, sport=sport, phase=phase,
        virtual=virtual, team=team, has_odds=has_odds,
        since=since, until=until, limit=limit,
    )
    return [MatchDTO(**r) for r in rows]


@router.get("/matches/count")
async def matches_count(
    tournament: Optional[str] = Query(None),
    sport: Optional[str] = Query(None),
    phase: Optional[str] = Query(None, regex="^(live|prematch|ended|active|unknown)$"),
    virtual: Optional[bool] = Query(None),
    team: Optional[str] = Query(None),
    has_odds: Optional[bool] = Query(None),
    since: Optional[str] = Query(None),
    until: Optional[str] = Query(None),
):
    """SELECT count(*) với cùng filter như /api/matches — không bị cap bởi limit."""
    n = await db.count_matches(
        tournament=tournament, sport=sport, phase=phase,
        virtual=virtual, team=team, has_odds=has_odds,
        since=since, until=until,
    )
    return {"count": n}


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


@router.get("/stats")
async def stats():
    """Dashboard tổng quan: count theo phase + odds/players/markets."""
    return await db.get_stats()


@router.get("/find")
async def find(
    text: str = Query(..., min_length=1, description="Text tìm ILIKE"),
    limit: int = Query(20, ge=1, le=100),
):
    """Full search trên matches, tournaments, players."""
    return await db.find_across(text, limit=limit)
