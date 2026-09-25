"""Pydantic DTOs cho REST + WS payload."""
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, Field


class MatchDTO(BaseModel):
    """Phản chiếu view v_matches_full / v_matches_with_score — join sports +
    tournaments + categories + competitors. Field `id` alias sang `match_id`
    để backward-compat với client cũ."""
    id: str = Field(alias="match_id")
    slug: Optional[str] = None
    scheduled_at: Optional[datetime] = None
    virtual: bool = False
    first_seen_at: Optional[datetime] = None
    last_seen_at: Optional[datetime] = None
    ended_at: Optional[datetime] = None

    sport_id: Optional[str] = None
    sport_name: Optional[str] = None
    sport_slug: Optional[str] = None

    tournament_id: Optional[str] = None
    tournament_name: Optional[str] = None
    tournament_tier: Optional[str] = None

    category_id: Optional[str] = None
    category_name: Optional[str] = None
    category_country: Optional[str] = None

    home_id: Optional[str] = None
    home_name: Optional[str] = None
    home_country: Optional[str] = None
    home_abbr: Optional[str] = None

    away_id: Optional[str] = None
    away_name: Optional[str] = None
    away_country: Optional[str] = None
    away_abbr: Optional[str] = None

    # Chỉ có trong v_matches_with_score (list endpoint)
    last_score_ts: Optional[datetime] = None
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    period: Optional[int] = None
    match_status: Optional[int] = None

    model_config = {"populate_by_name": True}


class ScoreEventDTO(BaseModel):
    ts: datetime
    match_id: str
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    period: Optional[int] = None
    match_status: Optional[int] = None


class ScoreUpdateBroadcast(BaseModel):
    """Payload publish vào Redis channel scores.updated."""
    match_id: str
    home_score: Optional[int] = None
    away_score: Optional[int] = None
    period: Optional[int] = None
    match_status: Optional[int] = None
    ts: datetime


# ─────────────── Dimension DTOs (tuỳ dùng cho routes future) ───────────────

class SportDTO(BaseModel):
    id: str
    name: str
    slug: Optional[str] = None
    inside_out: bool = False
    priority: int = 0


class TournamentDTO(BaseModel):
    id: str
    category_id: Optional[str] = None
    name: str
    slug: Optional[str] = None
    priority: int = 0
    priority_live: int = 0
    promo: bool = False
    tier: Optional[str] = None
