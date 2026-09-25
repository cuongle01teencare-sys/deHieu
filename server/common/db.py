"""asyncpg pool + schema init (idempotent).

Chuẩn hoá:
- Dimension: sports, categories, tournaments, competitors
- M:n: match_competitors (home/away)
- Fact: matches (slim), score_events, period_scores
- View: v_matches_full (join all), v_matches_with_score (+ latest score)

Migration: từ schema cũ (matches ôm home_id/name, away_id/name) → backfill
competitors + match_competitors rồi DROP cột. Idempotent.
"""
import asyncpg
from typing import Optional

from server.common.config import settings


SCHEMA = """
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ─────────────── DIMENSION TABLES ───────────────

-- Dimension tables: `name` cho phép NULL để support "anonymous stub" pattern.
-- Khi payload có FK ref (VD competitor.sport_id=319) mà sports chưa biết,
-- ta INSERT stub {id:319, name:NULL, ...} để giữ FK integrity. Khi Betby
-- gửi payload có sports["319"] thật, upsert fill nốt thông tin.
CREATE TABLE IF NOT EXISTS sports (
    id           TEXT PRIMARY KEY,
    name         TEXT,
    slug         TEXT,
    inside_out   BOOLEAN DEFAULT FALSE,
    priority     INT DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS categories (
    id           TEXT PRIMARY KEY,
    sport_id     TEXT REFERENCES sports(id),
    name         TEXT,
    slug         TEXT,
    country_code TEXT,
    priority     INT DEFAULT 0,
    updated_at   TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_categories_sport ON categories(sport_id);

CREATE TABLE IF NOT EXISTS tournaments (
    id            TEXT PRIMARY KEY,
    category_id   TEXT REFERENCES categories(id),
    name          TEXT,
    slug          TEXT,
    priority      INT DEFAULT 0,
    priority_live INT DEFAULT 0,
    promo         BOOLEAN DEFAULT FALSE,
    tier          TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_tournaments_category ON tournaments(category_id);

CREATE TABLE IF NOT EXISTS competitors (
    id            TEXT PRIMARY KEY,
    sport_id      TEXT REFERENCES sports(id),
    name          TEXT,
    country_code  TEXT,
    abbreviation  TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_competitors_sport ON competitors(sport_id);

-- Migration: DB cũ đã có NOT NULL trên name → drop.
DO $$
BEGIN
    ALTER TABLE sports      ALTER COLUMN name DROP NOT NULL;
    ALTER TABLE categories  ALTER COLUMN name DROP NOT NULL;
    ALTER TABLE tournaments ALTER COLUMN name DROP NOT NULL;
    ALTER TABLE competitors ALTER COLUMN name DROP NOT NULL;
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

-- ─────────────── MATCHES (slim) ───────────────

CREATE TABLE IF NOT EXISTS matches (
    id             TEXT PRIMARY KEY,
    sport_id       TEXT,
    tournament_id  TEXT,
    scheduled_at   TIMESTAMPTZ,
    virtual        BOOLEAN DEFAULT FALSE,
    slug           TEXT,
    first_seen_at  TIMESTAMPTZ DEFAULT NOW(),
    last_seen_at   TIMESTAMPTZ DEFAULT NOW(),
    ended_at       TIMESTAMPTZ
);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_matches_tournament ON matches(tournament_id);
CREATE INDEX IF NOT EXISTS idx_matches_sport      ON matches(sport_id);
CREATE INDEX IF NOT EXISTS idx_matches_scheduled  ON matches(scheduled_at DESC);

CREATE TABLE IF NOT EXISTS match_competitors (
    match_id      TEXT NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
    competitor_id TEXT NOT NULL REFERENCES competitors(id),
    side          TEXT NOT NULL CHECK (side IN ('home', 'away')),
    PRIMARY KEY (match_id, side)
);
CREATE INDEX IF NOT EXISTS idx_match_competitors_comp ON match_competitors(competitor_id);

-- ─────────────── MIGRATION: cột cũ trong matches ───────────────
-- Nếu DB cũ còn home_id/home_name/away_id/away_name → backfill sang
-- competitors + match_competitors rồi drop. Idempotent: chỉ chạy khi cột còn.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns
               WHERE table_name = 'matches' AND column_name = 'home_id') THEN

        INSERT INTO competitors (id, sport_id, name)
        SELECT DISTINCT home_id, sport_id, COALESCE(home_name, '')
        FROM matches WHERE home_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO competitors (id, sport_id, name)
        SELECT DISTINCT away_id, sport_id, COALESCE(away_name, '')
        FROM matches WHERE away_id IS NOT NULL
        ON CONFLICT (id) DO NOTHING;

        INSERT INTO match_competitors (match_id, competitor_id, side)
        SELECT id, home_id, 'home' FROM matches WHERE home_id IS NOT NULL
        ON CONFLICT DO NOTHING;

        INSERT INTO match_competitors (match_id, competitor_id, side)
        SELECT id, away_id, 'away' FROM matches WHERE away_id IS NOT NULL
        ON CONFLICT DO NOTHING;

        ALTER TABLE matches DROP COLUMN home_id;
        ALTER TABLE matches DROP COLUMN home_name;
        ALTER TABLE matches DROP COLUMN away_id;
        ALTER TABLE matches DROP COLUMN away_name;
    END IF;
END $$;

-- ─────────────── SCORE FACTS ───────────────

CREATE TABLE IF NOT EXISTS score_events (
    ts              TIMESTAMPTZ NOT NULL,
    match_id        TEXT        NOT NULL,
    home_score      INT,
    away_score      INT,
    period          INT,
    match_status    INT,
    raw             JSONB
);
DO $$
BEGIN
    PERFORM create_hypertable('score_events', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_score_events_match_ts ON score_events(match_id, ts DESC);

CREATE TABLE IF NOT EXISTS period_scores (
    ts                 TIMESTAMPTZ NOT NULL,
    match_id           TEXT        NOT NULL,
    period_number      INT         NOT NULL,
    match_status_code  INT,
    home_score         INT,
    away_score         INT
);
DO $$
BEGIN
    PERFORM create_hypertable('period_scores', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_period_scores_match_ts ON period_scores(match_id, ts DESC);

-- ─────────────── VIEWS ───────────────

CREATE OR REPLACE VIEW v_matches_full AS
SELECT
    m.id                      AS match_id,
    m.slug,
    m.scheduled_at,
    m.virtual,
    m.first_seen_at,
    m.last_seen_at,
    m.ended_at,
    s.id                      AS sport_id,
    s.name                    AS sport_name,
    s.slug                    AS sport_slug,
    t.id                      AS tournament_id,
    t.name                    AS tournament_name,
    t.tier                    AS tournament_tier,
    t.priority_live           AS tournament_priority_live,
    c.id                      AS category_id,
    c.name                    AS category_name,
    c.country_code            AS category_country,
    home.id                   AS home_id,
    home.name                 AS home_name,
    home.country_code         AS home_country,
    home.abbreviation         AS home_abbr,
    away.id                   AS away_id,
    away.name                 AS away_name,
    away.country_code         AS away_country,
    away.abbreviation         AS away_abbr,
    -- Direct URL mở trận trên CSGOEmpire (Betby SPA đọc `bt-path` param).
    -- NULL nếu thiếu bất kỳ slug nào (không thể build URL hợp lệ).
    CASE
        WHEN s.slug IS NOT NULL AND c.slug IS NOT NULL
         AND t.slug IS NOT NULL AND m.slug IS NOT NULL
        THEN 'https://csgoempire.com/match-betting?bt-path=/'
             || s.slug || '/' || c.slug || '/'
             || t.slug || '/' || m.slug || '-' || m.id
    END                       AS bet_url
FROM matches m
LEFT JOIN sports      s ON s.id = m.sport_id
LEFT JOIN tournaments t ON t.id = m.tournament_id
LEFT JOIN categories  c ON c.id = t.category_id
LEFT JOIN match_competitors mch ON mch.match_id = m.id AND mch.side = 'home'
LEFT JOIN competitors home ON home.id = mch.competitor_id
LEFT JOIN match_competitors mca ON mca.match_id = m.id AND mca.side = 'away'
LEFT JOIN competitors away ON away.id = mca.competitor_id;

CREATE OR REPLACE VIEW v_matches_with_score AS
SELECT
    f.*,
    ls.ts           AS last_score_ts,
    ls.home_score,
    ls.away_score,
    ls.period,
    ls.match_status
FROM v_matches_full f
LEFT JOIN LATERAL (
    SELECT ts, home_score, away_score, period, match_status
    FROM score_events se
    WHERE se.match_id = f.match_id
    ORDER BY ts DESC
    LIMIT 1
) ls ON TRUE;
"""


class Database:
    def __init__(self):
        self.pool: Optional[asyncpg.Pool] = None

    def _require_pool(self) -> asyncpg.Pool:
        """Trả pool sau khi assert đã connect (giúp Pylance narrow Optional)."""
        if self.pool is None:
            raise RuntimeError("Database chưa connect() — gọi await db.connect() trước")
        return self.pool

    async def connect(self):
        self.pool = await asyncpg.create_pool(
            settings.database_url, min_size=2, max_size=10
        )
        async with self._require_pool().acquire() as conn:
            await conn.execute(SCHEMA)

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    # ─────────────── STUB CREATORS (anonymous placeholder) ───────────────
    # Đảm bảo id tồn tại trước khi ghi row có FK trỏ tới. INSERT ... DO NOTHING
    # nên không đè lên record đã có thông tin đầy đủ.

    async def ensure_sport_stubs(self, ids) -> None:
        ids = [i for i in set(ids) if i]
        if not ids:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany(
                "INSERT INTO sports (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
                [(i,) for i in ids],
            )

    async def ensure_category_stubs(self, ids) -> None:
        ids = [i for i in set(ids) if i]
        if not ids:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany(
                "INSERT INTO categories (id) VALUES ($1) ON CONFLICT (id) DO NOTHING",
                [(i,) for i in ids],
            )

    # ─────────────── DIMENSION UPSERTS (batch) ───────────────
    # Nguyên tắc: mọi upsert dimension đều dùng COALESCE với NULLIF cho các
    # trường string, để row STUB (name=NULL) không bị "downgrade" từ real data,
    # và ngược lại real data update stub thì fill được thông tin.

    async def upsert_sports(self, rows: list[dict]):
        if not rows:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO sports (id, name, slug, inside_out, priority)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO UPDATE SET
                    name       = COALESCE(NULLIF(EXCLUDED.name, ''), sports.name),
                    slug       = COALESCE(EXCLUDED.slug, sports.slug),
                    inside_out = EXCLUDED.inside_out,
                    priority   = EXCLUDED.priority,
                    updated_at = NOW()
            """, [(r["id"], r.get("name"), r.get("slug"),
                   r.get("inside_out", False), r.get("priority", 0)) for r in rows])

    async def upsert_categories(self, rows: list[dict]):
        if not rows:
            return
        # Stub sports mà category ref, phòng khi Betby chưa khai
        await self.ensure_sport_stubs(r.get("sport_id") for r in rows)
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO categories (id, sport_id, name, slug, country_code, priority)
                VALUES ($1, $2, $3, $4, $5, $6)
                ON CONFLICT (id) DO UPDATE SET
                    sport_id     = COALESCE(EXCLUDED.sport_id, categories.sport_id),
                    name         = COALESCE(NULLIF(EXCLUDED.name, ''), categories.name),
                    slug         = COALESCE(EXCLUDED.slug, categories.slug),
                    country_code = COALESCE(EXCLUDED.country_code, categories.country_code),
                    priority     = EXCLUDED.priority,
                    updated_at   = NOW()
            """, [(r["id"], r.get("sport_id"), r.get("name"), r.get("slug"),
                   r.get("country_code"), r.get("priority", 0)) for r in rows])

    async def upsert_tournaments(self, rows: list[dict]):
        if not rows:
            return
        await self.ensure_category_stubs(r.get("category_id") for r in rows)
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO tournaments (id, category_id, name, slug, priority,
                                         priority_live, promo, tier)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO UPDATE SET
                    category_id   = COALESCE(EXCLUDED.category_id, tournaments.category_id),
                    name          = COALESCE(NULLIF(EXCLUDED.name, ''), tournaments.name),
                    slug          = COALESCE(EXCLUDED.slug, tournaments.slug),
                    priority      = EXCLUDED.priority,
                    priority_live = EXCLUDED.priority_live,
                    promo         = EXCLUDED.promo,
                    tier          = COALESCE(EXCLUDED.tier, tournaments.tier),
                    updated_at    = NOW()
            """, [(r["id"], r.get("category_id"), r.get("name"), r.get("slug"),
                   r.get("priority", 0), r.get("priority_live", 0),
                   r.get("promo", False), r.get("tier")) for r in rows])

    async def upsert_competitors(self, rows: list[dict]):
        if not rows:
            return
        await self.ensure_sport_stubs(r.get("sport_id") for r in rows)
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO competitors (id, sport_id, name, country_code, abbreviation)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (id) DO UPDATE SET
                    sport_id     = COALESCE(EXCLUDED.sport_id, competitors.sport_id),
                    name         = COALESCE(NULLIF(EXCLUDED.name, ''), competitors.name),
                    country_code = COALESCE(EXCLUDED.country_code, competitors.country_code),
                    abbreviation = COALESCE(EXCLUDED.abbreviation, competitors.abbreviation),
                    updated_at   = NOW()
            """, [(r["id"], r.get("sport_id"), r.get("name"),
                   r.get("country_code"), r.get("abbreviation")) for r in rows])

    # ─────────────── MATCHES ───────────────

    async def upsert_match(self, m: dict):
        async with self._require_pool().acquire() as conn:
            await conn.execute("""
                INSERT INTO matches (id, sport_id, tournament_id, scheduled_at,
                                     virtual, slug)
                VALUES ($1, $2, $3, to_timestamp($4), $5, $6)
                ON CONFLICT (id) DO UPDATE SET
                    last_seen_at  = NOW(),
                    sport_id      = COALESCE(EXCLUDED.sport_id,      matches.sport_id),
                    tournament_id = COALESCE(EXCLUDED.tournament_id, matches.tournament_id),
                    scheduled_at  = COALESCE(EXCLUDED.scheduled_at,  matches.scheduled_at)
            """,
                m["id"], m.get("sport_id"), m.get("tournament_id"),
                m.get("scheduled"), m.get("virtual", False), m.get("slug"),
            )

    async def upsert_match_competitors(self, rows: list[dict]):
        if not rows:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO match_competitors (match_id, competitor_id, side)
                VALUES ($1, $2, $3)
                ON CONFLICT (match_id, side) DO UPDATE SET
                    competitor_id = EXCLUDED.competitor_id
            """, [(r["match_id"], r["competitor_id"], r["side"]) for r in rows])

    # ─────────────── SCORE / PERIOD ───────────────

    async def insert_score(self, evt: dict):
        async with self._require_pool().acquire() as conn:
            await conn.execute("""
                INSERT INTO score_events (ts, match_id, home_score, away_score,
                                          period, match_status, raw)
                VALUES (NOW(), $1, $2, $3, $4, $5, $6::jsonb)
            """,
                evt["match_id"], evt.get("home_score"), evt.get("away_score"),
                evt.get("period"), evt.get("match_status"),
                evt.get("raw_json", "{}"),
            )

    async def insert_period_scores(self, match_id: str, periods: list[dict]):
        """Insert snapshot của period_scores tại ts=NOW() cho 1 match.
        `periods` = list các dict {number, match_status_code, home_score, away_score}."""
        if not periods:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO period_scores (ts, match_id, period_number,
                                           match_status_code, home_score, away_score)
                VALUES (NOW(), $1, $2, $3, $4, $5)
            """, [(match_id, p["number"], p.get("match_status_code"),
                   p.get("home_score"), p.get("away_score")) for p in periods])

    # ─────────────── READS ───────────────

    async def list_matches(self, tournament: Optional[str] = None,
                           sport: Optional[str] = None, limit: int = 50):
        args: list = []
        conds: list = []
        if tournament:
            args.append(tournament)
            conds.append(f"tournament_id = ${len(args)}")
        if sport:
            args.append(sport)
            conds.append(f"sport_id = ${len(args)}")
        q = "SELECT * FROM v_matches_with_score"
        if conds:
            q += " WHERE " + " AND ".join(conds)
        args.append(int(limit))
        q += f" ORDER BY last_seen_at DESC LIMIT ${len(args)}"
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch(q, *args)
            return [dict(r) for r in rows]

    async def get_match(self, match_id: str):
        async with self._require_pool().acquire() as conn:
            r = await conn.fetchrow(
                "SELECT * FROM v_matches_full WHERE match_id = $1", match_id
            )
            return dict(r) if r else None

    async def scores_of(self, match_id: str, since_iso: Optional[str] = None, limit: int = 500):
        args: list = [match_id]
        q = ("SELECT ts, match_id, home_score, away_score, period, match_status "
             "FROM score_events WHERE match_id=$1")
        if since_iso:
            args.append(since_iso)
            q += f" AND ts >= ${len(args)}::timestamptz"
        args.append(int(limit))
        q += f" ORDER BY ts DESC LIMIT ${len(args)}"
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch(q, *args)
            return [dict(r) for r in rows]

    async def last_scores_map(self):
        """Trả {match_id: (home_score, away_score, period, match_status)} từ score
        gần nhất của mỗi match — dùng để hydrate seen_scores khi poller restart."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT DISTINCT ON (match_id) match_id, home_score, away_score,
                       period, match_status
                FROM score_events
                ORDER BY match_id, ts DESC
            """)
            return {r["match_id"]: (r["home_score"], r["away_score"],
                                    r["period"], r["match_status"]) for r in rows}

    async def known_match_ids(self) -> set:
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("SELECT id FROM matches")
            return {r["id"] for r in rows}

    async def mark_ended(self, match_id: str) -> bool:
        async with self._require_pool().acquire() as conn:
            row = await conn.fetchrow(
                "UPDATE matches SET ended_at = NOW() "
                "WHERE id=$1 AND ended_at IS NULL RETURNING id",
                match_id
            )
            return row is not None

db = Database()
