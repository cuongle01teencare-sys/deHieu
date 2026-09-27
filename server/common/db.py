"""asyncpg pool + schema init (idempotent).

Chuẩn hoá:
- Dimension: sports, categories, tournaments, competitors
- M:n: match_competitors (home/away)
- Fact: matches (slim), score_events, period_scores
- View: v_csgoempire_matches_full (join all), v_matches_with_score (+ latest score)

Migration: từ schema cũ (matches ôm home_id/name, away_id/name) → backfill
competitors + match_competitors rồi DROP cột. Idempotent.
"""
import json
import asyncpg
from typing import Optional

from server.common.config import settings
from server.common import errlog


class OrphanReferenceEvent(Exception):
    """Non-fatal: FK-referenced id chưa có row thực trong parent table → stub
    được tạo. Không phải crash, chỉ để errlog tracking cho investigation sau.
    Xem đây như 'feature signal' rằng Betby gửi ref không đầy đủ."""
    def __init__(self, kind: str, ids: list):
        self.kind = kind
        self.ids = ids
        preview = ids[:20]
        more = f" (+{len(ids) - 20} more)" if len(ids) > 20 else ""
        super().__init__(f"Auto-stubbed {kind}: {preview}{more}")


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

-- ─────────────── TEAM ALIASES (cross-platform) ───────────────
-- Bảng shared cho normalize tên team giữa các tenant. VD:
--   canonical='natus vincere', alias='navi', sport='cs2'
-- Poller mỗi tenant khi ingest 1 event → normalize tên team → resolve qua
-- bảng này để ra canonical name → so sánh với canonical name bên tenant
-- khác. Nếu tên trùng exact (đã normalize) thì không cần row alias.
-- Seed bảng này qua CLI hoặc SQL trực tiếp; poller không tự học alias.
CREATE TABLE IF NOT EXISTS team_aliases (
    sport            TEXT NOT NULL,     -- 'cs2', 'dota2', ...
    alias            TEXT NOT NULL,     -- 'navi' (đã normalize: lowercase + alphanumeric only)
    canonical_name   TEXT NOT NULL,     -- 'natus vincere' (viết chuẩn để hiển thị)
    canonical_norm   TEXT NOT NULL,     -- 'natusvincere' (normalized của canonical, để join)
    source           TEXT DEFAULT 'manual',  -- 'manual' | 'imported:hltv' | ...
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (sport, alias)
);
CREATE INDEX IF NOT EXISTS idx_team_aliases_canon ON team_aliases (sport, canonical_norm);


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
    ended_at       TIMESTAMPTZ,
    -- 'prematch' | 'live' | 'ended' | NULL. Set bởi loop nào thấy match ở
    -- iter cuối: live_loop → 'live' (luôn), prematch_loop → 'prematch' chỉ
    -- khi phase hiện tại KHÔNG phải 'live' (không demote match live).
    -- mark_ended → 'ended'. Reactivate → reset theo loop nào thấy.
    phase          TEXT CHECK (phase IN ('prematch', 'live', 'ended'))
);
ALTER TABLE matches ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS phase TEXT;
DO $$ BEGIN
    ALTER TABLE matches ADD CONSTRAINT matches_phase_chk
        CHECK (phase IN ('prematch', 'live', 'ended'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_matches_phase ON matches(phase);
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

-- ─────────────── VIEW ───────────────
-- 1 view duy nhất: metadata + latest score + bet_url. LATERAL JOIN dùng
-- idx_score_events_match_ts nên cost ~= 1 index lookup / row.
-- Drop v_matches_with_score cũ (đã merge vào đây).
DROP VIEW IF EXISTS v_matches_with_score;

-- Drop tên cũ v_matches_full (đã rename thành v_csgoempire_matches_full).
-- Migration: DB cũ có view v_matches_full → xoá để không dangling.
DROP VIEW IF EXISTS v_matches_full CASCADE;

-- Drop v_csgoempire_matches_full luôn để force recreate với column list mới nhất.
-- CREATE OR REPLACE có nhiều edge case (không cho thay đổi type, không cho
-- chèn column giữa, v.v.) khiến schema drift âm thầm. Drop rồi tạo lại là
-- an toàn nhất — view không có phụ thuộc nào khác trong repo này.
DROP VIEW IF EXISTS v_csgoempire_matches_full CASCADE;

CREATE OR REPLACE VIEW v_csgoempire_matches_full AS
SELECT
    m.id                      AS match_id,
    m.slug,
    m.phase,
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
    -- Latest score snapshot (NULL nếu match chưa có score_event nào)
    ls.ts                     AS last_score_ts,
    ls.home_score,
    ls.away_score,
    ls.period,
    ls.match_status,
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
LEFT JOIN competitors away ON away.id = mca.competitor_id
LEFT JOIN LATERAL (
    SELECT ts, home_score, away_score, period, match_status
    FROM score_events se
    WHERE se.match_id = m.id
    ORDER BY ts DESC
    LIMIT 1
) ls ON TRUE;
"""


# ─────────────── SCHEMA cho markets/odds (namespace tách rời) ───────────────
# Nằm trong schema `odds` — độc lập với `public` (source-of-truth match info).
# Mọi table đều có cột `platform` → cùng cấu trúc phục vụ csgoempire hôm nay,
# Pinnacle / GG.BET / ... mai sau.
SCHEMA_ODDS = """
CREATE SCHEMA IF NOT EXISTS odds;

-- Từ điển market chung của platform. Fetch từ /api/v3/descriptions/.../markets/en,
-- refresh chậm (1h). Dùng để render tên market/outcome khi build response query.
CREATE TABLE IF NOT EXISTS odds.market_descriptors (
    platform      TEXT NOT NULL,
    market_id     TEXT NOT NULL,
    name_template TEXT,             -- "{!mapnr} map - winner"
    market_type   TEXT,             -- "Result", "Handicap", "Total"...
    specifiers    TEXT[],           -- ["mapnr", "hcp"]
    variants      JSONB,            -- raw variants{} → tra outcome name theo id
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (platform, market_id)
);

-- Per-event override: sptpub trả sẵn tên đã render với player/team specific.
-- Dùng đây cho player-props markets (60040/60041/60043) — đỡ phải render tay.
CREATE TABLE IF NOT EXISTS odds.event_market_overrides (
    platform      TEXT NOT NULL,
    match_id      TEXT NOT NULL,
    market_id     TEXT NOT NULL,
    specifier_key TEXT NOT NULL,
    market_name   TEXT,             -- "First map - Graviti total kills"
    outcomes      JSONB,            -- [{id, name, player_id?, competitor_id?}]
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (platform, match_id, market_id, specifier_key)
);
CREATE INDEX IF NOT EXISTS idx_event_mkt_ovr_match
    ON odds.event_market_overrides (platform, match_id);

-- Player id → tên (extract từ per-event descriptions).
CREATE TABLE IF NOT EXISTS odds.players (
    platform      TEXT NOT NULL,
    player_id     TEXT NOT NULL,   -- "od:player:3191537:29:1218"
    name          TEXT,
    competitor_id TEXT,
    updated_at    TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (platform, player_id)
);
CREATE INDEX IF NOT EXISTS idx_players_competitor
    ON odds.players (platform, competitor_id);

-- match_status code → chữ (0="Not started", 1="1st period", ...).
CREATE TABLE IF NOT EXISTS odds.status_labels (
    platform   TEXT NOT NULL,
    code       INT NOT NULL,
    label      TEXT,
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (platform, code)
);

-- Snapshot hiện tại — UPSERT, luôn latest. Đây là bảng CLI query chính.
CREATE TABLE IF NOT EXISTS odds.odds_current (
    platform          TEXT NOT NULL,
    match_id          TEXT NOT NULL,
    market_id         TEXT NOT NULL,
    specifier_key     TEXT NOT NULL,   -- "" khi market không có specifier
    outcome_id        TEXT NOT NULL,
    decimal_odds      NUMERIC(10,4),
    -- Canonical labels để arb JOIN không phải biết raw ID map giữa platforms.
    -- 'winner' + 'home'/'away' cho market moneyline 2-way. NULL nếu adapter
    -- chưa map được (VD market khác moneyline, hoặc tên team không align).
    canonical_market  TEXT,
    canonical_outcome TEXT,
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (platform, match_id, market_id, specifier_key, outcome_id)
);
-- Migration: DB cũ chưa có 2 cột canonical → ADD IF NOT EXISTS (idempotent).
ALTER TABLE odds.odds_current ADD COLUMN IF NOT EXISTS canonical_market  TEXT;
ALTER TABLE odds.odds_current ADD COLUMN IF NOT EXISTS canonical_outcome TEXT;
CREATE INDEX IF NOT EXISTS idx_odds_current_match
    ON odds.odds_current (platform, match_id);
-- Index cho arb JOIN theo canonical (chỉ index row đã map).
CREATE INDEX IF NOT EXISTS idx_odds_current_canonical
    ON odds.odds_current (match_id, canonical_market, canonical_outcome, platform)
    WHERE canonical_market IS NOT NULL;

-- Timeseries — hypertable, chỉ INSERT khi giá đổi (dedup ở tầng ứng dụng).
CREATE TABLE IF NOT EXISTS odds.odds_history (
    ts                TIMESTAMPTZ NOT NULL,
    platform          TEXT NOT NULL,
    match_id          TEXT NOT NULL,
    market_id         TEXT NOT NULL,
    specifier_key     TEXT NOT NULL,
    outcome_id        TEXT NOT NULL,
    decimal_odds      NUMERIC(10,4),
    canonical_market  TEXT,
    canonical_outcome TEXT
);
ALTER TABLE odds.odds_history ADD COLUMN IF NOT EXISTS canonical_market  TEXT;
ALTER TABLE odds.odds_history ADD COLUMN IF NOT EXISTS canonical_outcome TEXT;
DO $$
BEGIN
    PERFORM create_hypertable('odds.odds_history', 'ts', if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN NULL;
END $$;
CREATE INDEX IF NOT EXISTS idx_odds_history_match_ts
    ON odds.odds_history (platform, match_id, ts DESC);

-- ─── PHASE 3: arb opportunities table ───
-- Mỗi row = 1 cơ hội arb ĐÃ ĐƯỢC PHÁT HIỆN cho (match, direction).
-- Sống từ INSERT tới khi edge âm/stale (UPDATE closed_at).
-- Chỉ INSERT row mới khi edge tăng >= 0.5% so với row open. Không thì
-- chỉ touch last_seen + peak để tránh spam.
CREATE TABLE IF NOT EXISTS odds.arb_opportunities (
    id                    BIGSERIAL PRIMARY KEY,
    detected_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at             TIMESTAMPTZ,
    closed_reason         TEXT,
    canonical_match_id    TEXT NOT NULL,
    direction             TEXT NOT NULL,
    sptpub_side           TEXT NOT NULL,
    poly_side             TEXT NOT NULL,
    sptpub_odds           NUMERIC NOT NULL,
    poly_odds             NUMERIC NOT NULL,
    sum_inverse           NUMERIC NOT NULL,
    edge_percent          NUMERIC NOT NULL,
    peak_edge_percent     NUMERIC NOT NULL,
    sptpub_updated_at     TIMESTAMPTZ,
    poly_updated_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS arb_open_uniq
    ON odds.arb_opportunities (canonical_match_id, direction)
    WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arb_open ON odds.arb_opportunities (closed_at) WHERE closed_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_arb_match ON odds.arb_opportunities (canonical_match_id, detected_at DESC);
"""


# ─────────────── SCHEDULED JOBS + RETENTION ───────────────
# Chạy sau SCHEMA + SCHEMA_ODDS. Tất cả DO $$...$$ block wrap trong EXCEPTION
# để migration KHÔNG fail trên image cũ (không có pg_cron / không có
# shared_preload_libraries=pg_cron loaded). Idempotent 100%.
#
# 3 phần:
#   1. Retention policy cho 3 hypertable — Timescale drop_chunks background.
#      Rule: dữ liệu > 30 ngày sẽ bị drop (drop theo TIME, không phải theo
#      match). Ưu điểm: cực nhanh (O(1) filesystem op), không lock.
#   2. Cài pg_cron extension. Chỉ chạy được nếu image có sẵn pg_cron .so +
#      postmaster đã load qua shared_preload_libraries.
#   3. Job `cleanup-ended-matches` — mỗi giờ xoá matches phase=ended > 7 ngày
#      cùng các bảng con không có FK cascade (odds.odds_current,
#      odds.event_market_overrides). match_competitors auto cascade từ matches.
SCHEMA_JOBS = """
-- 1) Retention policy — hypertables tự dọn chunk cũ
DO $$ BEGIN
    PERFORM add_retention_policy('score_events',      INTERVAL '30 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('period_scores',     INTERVAL '30 days', if_not_exists => TRUE);
    PERFORM add_retention_policy('odds.odds_history', INTERVAL '30 days', if_not_exists => TRUE);
    RAISE NOTICE '[migration] retention policies OK (30 days)';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] add_retention_policy failed: %', SQLERRM;
END $$;

-- 2) pg_cron extension. Nếu image cũ không có → skip nhẹ.
DO $$ BEGIN
    CREATE EXTENSION IF NOT EXISTS pg_cron;
    RAISE NOTICE '[migration] pg_cron extension OK';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] pg_cron unavailable — cleanup job sẽ KHÔNG chạy. Cần image có pg_cron + shared_preload_libraries=pg_cron trong postgresql.conf. Lỗi: %', SQLERRM;
END $$;

-- 3) Schedule cleanup job. cron.schedule là UPSERT theo tên → idempotent.
DO $$ BEGIN
    PERFORM cron.schedule(
        'cleanup-ended-matches',
        '0 * * * *',   -- đầu mỗi giờ (UTC)
        $CRON$
        -- Xoá theo thứ tự child → parent (không có FK cascade cho odds.* +
        -- hypertables). retention_policy 30 ngày là net an toàn thứ 2 — dọn
        -- chunks cũ theo TIME, còn cron này dọn rows theo MATCH_ID sớm hơn.
        WITH victims AS (
            SELECT id FROM matches WHERE phase='ended' AND ended_at < NOW() - INTERVAL '7 days'
        )
        , d_oc  AS (DELETE FROM odds.odds_current           WHERE match_id IN (SELECT id FROM victims))
        , d_emo AS (DELETE FROM odds.event_market_overrides WHERE match_id IN (SELECT id FROM victims))
        , d_oh  AS (DELETE FROM odds.odds_history           WHERE match_id IN (SELECT id FROM victims))
        , d_se  AS (DELETE FROM score_events                WHERE match_id IN (SELECT id FROM victims))
        , d_ps  AS (DELETE FROM period_scores               WHERE match_id IN (SELECT id FROM victims))
        -- match_competitors ON DELETE CASCADE từ matches → auto handled
        DELETE FROM matches WHERE id IN (SELECT id FROM victims);
        $CRON$
    );
    RAISE NOTICE '[migration] cron job cleanup-ended-matches scheduled';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] cron.schedule failed: %', SQLERRM;
END $$;

-- 4) Compression cho hypertables — bottleneck chính là odds.odds_history
-- (84% DB). Nén chunks > 1 ngày, giảm ~15×. ALTER TABLE SET compress
-- không idempotent → wrap EXCEPTION riêng. Segmentby theo (platform, match_id)
-- vì query gần như luôn filter theo match; orderby ts DESC vì query thường
-- lấy giá gần nhất trước.
DO $$ BEGIN
    ALTER TABLE odds.odds_history SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'platform, match_id',
        timescaledb.compress_orderby   = 'ts DESC'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] compress config odds.odds_history: %', SQLERRM;
END $$;

DO $$ BEGIN
    ALTER TABLE score_events SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'match_id',
        timescaledb.compress_orderby   = 'ts DESC'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] compress config score_events: %', SQLERRM;
END $$;

DO $$ BEGIN
    ALTER TABLE period_scores SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'match_id',
        timescaledb.compress_orderby   = 'ts DESC'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] compress config period_scores: %', SQLERRM;
END $$;

-- 5) Compression policy + chunk interval 1 day (thay vì 7d default).
-- Chunks nhỏ giúp: (a) retention drop granular hơn, (b) compression sớm hơn,
-- (c) query range hẹp không phải scan chunk lớn. Cả 2 func idempotent.
DO $$ BEGIN
    PERFORM add_compression_policy('odds.odds_history', INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM add_compression_policy('score_events',      INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM add_compression_policy('period_scores',     INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM set_chunk_time_interval('odds.odds_history', INTERVAL '1 day');
    PERFORM set_chunk_time_interval('score_events',      INTERVAL '1 day');
    PERFORM set_chunk_time_interval('period_scores',     INTERVAL '1 day');
    RAISE NOTICE '[migration] compression policies + chunk intervals OK (1 day)';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] compression policies/chunk intervals failed: %', SQLERRM;
END $$;

-- 6) Autovacuum tuning cho odds.odds_current — UPSERT rate cao, dead tuples
-- tích luỹ nhanh. Default autovacuum chạy khi dead > 20% → mình thấy 18% bloat.
-- Set 5% để autovacuum aggressive hơn, giữ dead < 10% liên tục.
DO $$ BEGIN
    ALTER TABLE odds.odds_current SET (
        autovacuum_vacuum_scale_factor  = 0.05,
        autovacuum_analyze_scale_factor = 0.02
    );
    RAISE NOTICE '[migration] autovacuum tune for odds.odds_current OK';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] autovacuum tune failed: %', SQLERRM;
END $$;


-- ─── MIGRATION: rollback bid/ask khỏi odds.* (đã chuyển sang polymarket.market_prices) ───
-- Nếu DB fresh: 3 DROP COLUMN IF EXISTS no-op, không lỗi. Nếu DB cũ đã có
-- các cột (do 1 lần deploy nhầm giữa chừng): drop sạch để không dangling.
ALTER TABLE odds.odds_current ADD COLUMN IF NOT EXISTS placeholder_dummy_col INT;
ALTER TABLE odds.odds_current DROP COLUMN IF EXISTS placeholder_dummy_col;
ALTER TABLE odds.odds_current DROP COLUMN IF EXISTS best_bid;
ALTER TABLE odds.odds_current DROP COLUMN IF EXISTS best_ask;
ALTER TABLE odds.odds_current DROP COLUMN IF EXISTS source_ts;
ALTER TABLE odds.odds_history DROP COLUMN IF EXISTS best_bid;
ALTER TABLE odds.odds_history DROP COLUMN IF EXISTS best_ask;
ALTER TABLE odds.odds_history DROP COLUMN IF EXISTS source_ts;
"""




# ─────────────── SCHEMA cho polymarket tenant ───────────────
# Namespace riêng — SoT nội bộ của polymarket. Không có cột `platform` vì
# schema chính là platform. Đây là template cho mọi tenant tương lai:
#   <tenant>.events        — catalog event (trận đấu poly biết đến)
#   <tenant>.markets       — catalog market của từng event
#   <tenant>.match_map     — pointer từ event_id của poly → canonical match_id
#   <tenant>.unmapped_events — buffer những event chưa resolve được match
#
# `odds.*` là integration layer duy nhất; poller ghi vào đó với
# `match_id = canonical_match_id` (từ match_map lookup).
SCHEMA_POLYMARKET = """
CREATE SCHEMA IF NOT EXISTS polymarket;

-- Raw catalog event từ /events/keyset. Upsert mỗi lần poll, `last_seen` cập nhật.
CREATE TABLE IF NOT EXISTS polymarket.events (
    event_id            TEXT PRIMARY KEY,        -- poly numeric event.id
    slug                TEXT NOT NULL,
    title               TEXT NOT NULL,
    sport               TEXT,                    -- 'cs2', ... (từ event.sport.sport)
    league              TEXT,                    -- eventMetadata.league
    tournament          TEXT,                    -- eventMetadata.tournament
    grid_series_id      TEXT,                    -- eventMetadata.gridSeriesId, nullable
    pandascore_match_id BIGINT,                  -- eventMetadata.pandascoreMatchId, nullable
    home_team           TEXT NOT NULL,           -- teams[] where ordering='home'
    away_team           TEXT NOT NULL,           -- teams[] where ordering='away'
    home_provider_id    BIGINT,                  -- teams[].providerId (home)
    away_provider_id    BIGINT,                  -- teams[].providerId (away)
    start_time          TIMESTAMPTZ,             -- event.startTime
    live                BOOLEAN NOT NULL,
    ended               BOOLEAN NOT NULL,
    closed              BOOLEAN NOT NULL,
    raw                 JSONB NOT NULL,          -- full event object cho debug/extend
    first_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_poly_events_start   ON polymarket.events (start_time) WHERE NOT ended;
CREATE INDEX IF NOT EXISTS idx_poly_events_panda   ON polymarket.events (pandascore_match_id) WHERE pandascore_match_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poly_events_grid    ON polymarket.events (grid_series_id) WHERE grid_series_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_poly_events_sport   ON polymarket.events (sport);

-- Market thuộc event. Không FK sang events để tránh race khi upsert song song.
CREATE TABLE IF NOT EXISTS polymarket.markets (
    condition_id        TEXT PRIMARY KEY,        -- 0x-hex 32-byte, unique trên Polygon
    event_id            TEXT NOT NULL,           -- FK logic (không hard FK vì race)
    market_id           TEXT NOT NULL,           -- poly numeric market.id (secondary key)
    market_type         TEXT NOT NULL,           -- 'moneyline', 'child_moneyline', 'totals', ...
    group_title         TEXT,                    -- 'Match Winner', 'Map 1 Winner', ...
    outcomes            TEXT[] NOT NULL,         -- ['Team A', 'Team B']
    clob_token_ids      TEXT[] NOT NULL,         -- 2 uint256 (key subscribe WS ticker)
    -- Canonical outcome mapping cho arb: home/away_token_id lấy 1 phần tử của
    -- clob_token_ids dựa trên so tên team trong outcomes[] với event.home/away_team.
    -- Chỉ populate cho moneyline market khi tên align — NULL nếu không thể decide.
    home_token_id       TEXT,
    away_token_id       TEXT,
    accepting_orders    BOOLEAN,
    end_date            TIMESTAMPTZ,
    raw                 JSONB NOT NULL,
    first_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE polymarket.markets ADD COLUMN IF NOT EXISTS home_token_id TEXT;
ALTER TABLE polymarket.markets ADD COLUMN IF NOT EXISTS away_token_id TEXT;
CREATE INDEX IF NOT EXISTS idx_poly_markets_event ON polymarket.markets (event_id);
CREATE INDEX IF NOT EXISTS idx_poly_markets_type  ON polymarket.markets (market_type);

-- ─── PHASE 2A: raw price catalog cho poly WS ticks ───
-- Bid/ask/last_trade là raw concepts của order book poly — sptpub không có
-- (sptpub trả decimal_odds duy nhất). Nên nằm trong schema `polymarket`.
-- `odds.odds_current` chỉ nhận canonical `decimal_odds = 1/best_ask` — đảm
-- bảo integration layer đơn giản, cross-platform join sạch.
CREATE TABLE IF NOT EXISTS polymarket.market_prices (
    condition_id     TEXT NOT NULL,       -- market ID (0x-hex)
    token_id         TEXT NOT NULL,       -- 1 outcome = 1 token (uint256)
    best_bid         NUMERIC,             -- top-of-book bid (từ WS diff)
    best_ask         NUMERIC,             -- top-of-book ask
    last_trade_price NUMERIC,             -- optional, nếu WS trả
    source_ts        TIMESTAMPTZ,         -- poly server timestamp (from msg)
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (condition_id, token_id)
);
CREATE INDEX IF NOT EXISTS idx_poly_prices_condition ON polymarket.market_prices (condition_id);

-- Price tick history — append-only, hypertable. Chỉ INSERT khi (bid, ask) đổi.
-- Segment/order/compression tương tự odds.odds_history.
CREATE TABLE IF NOT EXISTS polymarket.price_history (
    ts               TIMESTAMPTZ NOT NULL,
    condition_id     TEXT NOT NULL,
    token_id         TEXT NOT NULL,
    best_bid         NUMERIC,
    best_ask         NUMERIC,
    source_ts        TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_poly_price_hist ON polymarket.price_history (condition_id, token_id, ts DESC);

DO $$ BEGIN
    PERFORM create_hypertable('polymarket.price_history', 'ts',
                              if_not_exists => TRUE);
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] create_hypertable polymarket.price_history: %', SQLERRM;
END $$;

-- Ghép event_id của poly → canonical match_id (sptpub) trong public.matches.
-- 1-1 trong phạm vi tenant: 1 event poly chỉ trỏ tới tối đa 1 canonical match.
CREATE TABLE IF NOT EXISTS polymarket.match_map (
    event_id            TEXT PRIMARY KEY,
    canonical_match_id  TEXT NOT NULL REFERENCES public.matches(id) ON DELETE CASCADE,
    confidence          NUMERIC NOT NULL CHECK (confidence BETWEEN 0 AND 1),
    method              TEXT NOT NULL,           -- 'exact_norm', 'alias', 'manual'
    match_details       JSONB,                   -- debug: normalized names, time_diff, ...
    verified_by         TEXT,                    -- 'auto' | username
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (canonical_match_id)                  -- 1 sptpub match chỉ có 1 poly event
);

-- Buffer: event poly gặp nhưng chưa map được. Retry sau (khi sptpub xuất
-- hiện trận đó, hoặc user thêm alias). Không phải error, là expected state.
CREATE TABLE IF NOT EXISTS polymarket.unmapped_events (
    event_id            TEXT PRIMARY KEY,
    reason              TEXT NOT NULL,           -- 'no_candidates' | 'multiple_candidates' | 'sport_not_supported'
    candidates          JSONB,                   -- top 3 sptpub match_id + score, cho user duyệt
    attempts            INT NOT NULL DEFAULT 1,
    first_seen          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_attempt        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ─── VIEW: v_polymarket_matches_full ───
-- Presentation view: gộp events + match_map để một query duy nhất hiển thị
-- được trận poly kèm cờ đã map hay chưa. `mapped` boolean tiện cho UI filter.
-- Nếu đã map, `canonical_match_id` + `mapping_*` cho biết map tới sptpub id nào.
CREATE OR REPLACE VIEW v_polymarket_matches_full AS
SELECT
    pe.event_id,
    pe.slug,
    pe.title,
    pe.sport,
    pe.league,
    pe.tournament,
    pe.home_team,
    pe.away_team,
    pe.home_provider_id,
    pe.away_provider_id,
    pe.grid_series_id,
    pe.pandascore_match_id,
    pe.start_time,
    pe.live,
    pe.ended,
    pe.closed,
    pe.first_seen,
    pe.last_seen,
    -- Cờ mapping: TRUE khi có row trong polymarket.match_map
    (mm.event_id IS NOT NULL)  AS mapped,
    mm.canonical_match_id,
    mm.confidence              AS mapping_confidence,
    mm.method                  AS mapping_method,
    mm.verified_by             AS mapping_verified_by,
    mm.updated_at              AS mapping_updated_at,
    -- Direct URL mở trận trên polymarket.com (slug là human-readable id)
    'https://polymarket.com/event/' || pe.slug AS bet_url
FROM polymarket.events pe
LEFT JOIN polymarket.match_map mm ON mm.event_id = pe.event_id;


-- ─── VIEW: v_matched_pairs ───
-- Chỉ hiển thị trận ĐÃ MAP giữa 2 nền tảng — cho user verify tính legit bằng
-- cách click 2 URL side-by-side. Nếu 2 trang mở ra là 2 trận khác nhau ↔
-- mapping sai, cần thêm alias hoặc điều chỉnh threshold.
--
-- Query mẫu:
--   SELECT * FROM v_matched_pairs WHERE mapping_confidence < 1.0;   -- nghi vấn
--   SELECT * FROM v_matched_pairs ORDER BY sptpub_scheduled ASC;    -- sắp diễn ra
CREATE OR REPLACE VIEW v_matched_pairs AS
SELECT
    -- Mapping metadata
    mm.canonical_match_id,
    mm.event_id                    AS polymarket_event_id,
    mm.confidence                  AS mapping_confidence,
    mm.method                      AS mapping_method,
    mm.verified_by                 AS mapping_verified_by,
    mm.updated_at                  AS mapping_updated_at,

    -- Sptpub side (từ v_csgoempire_matches_full)
    cm.home_name                   AS sptpub_home,
    cm.away_name                   AS sptpub_away,
    cm.tournament_name             AS sptpub_tournament,
    cm.sport_name                  AS sptpub_sport,
    cm.scheduled_at                AS sptpub_scheduled,
    cm.phase                       AS sptpub_phase,

    -- Polymarket side (từ v_polymarket_matches_full)
    pm.home_team                   AS poly_home,
    pm.away_team                   AS poly_away,
    pm.league                      AS poly_league,
    pm.tournament                  AS poly_tournament,
    pm.sport                       AS poly_sport,
    pm.start_time                  AS poly_start_time,
    pm.live                        AS poly_live,

    -- Chênh lệch thời gian giữa 2 nền tảng (giây) — sanity check mapping.
    -- Bình thường nhỏ; > 3600s là dấu hiệu mapping sai lệch.
    EXTRACT(EPOCH FROM (pm.start_time - cm.scheduled_at))::INT
                                   AS time_diff_seconds,

    -- 2 URL cạnh nhau cho tiện verify tay
    cm.bet_url                     AS csgoempire_url,
    pm.bet_url                     AS polymarket_url
FROM polymarket.match_map mm
JOIN v_csgoempire_matches_full cm ON cm.match_id = mm.canonical_match_id
JOIN v_polymarket_matches_full pm ON pm.event_id = mm.event_id;


-- 7) Retention + compression cho polymarket.price_history (Phase 2A hypertable).
--    Tần suất tick cao (~5-10/s per market × N market) → phình nhanh nhất
--    trong nhóm bảng mới. Cùng chính sách odds.odds_history.
DO $$ BEGIN
    PERFORM add_retention_policy('polymarket.price_history', INTERVAL '30 days', if_not_exists => TRUE);
    RAISE NOTICE '[migration] retention polymarket.price_history OK (30 days)';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] add_retention_policy polymarket.price_history failed: %', SQLERRM;
END $$;

DO $$ BEGIN
    ALTER TABLE polymarket.price_history SET (
        timescaledb.compress,
        timescaledb.compress_segmentby = 'condition_id, token_id',
        timescaledb.compress_orderby   = 'ts DESC'
    );
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] compress config polymarket.price_history: %', SQLERRM;
END $$;

DO $$ BEGIN
    PERFORM add_compression_policy('polymarket.price_history', INTERVAL '1 day', if_not_exists => TRUE);
    PERFORM set_chunk_time_interval('polymarket.price_history', INTERVAL '1 day');
    RAISE NOTICE '[migration] compression policy + chunk interval polymarket.price_history OK';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] compression polymarket.price_history failed: %', SQLERRM;
END $$;


-- 8) Backfill canonical cho sptpub Winner market 186 (2-way).
--    Idempotent qua `WHERE canonical_outcome IS NULL` — chạy lại no-op.
DO $$ BEGIN
    UPDATE odds.odds_current
    SET canonical_market  = 'winner',
        canonical_outcome = CASE outcome_id
            WHEN '4' THEN 'home'
            WHEN '5' THEN 'away'
        END
    WHERE platform = 'sptpub'
      AND market_id = '186'
      AND outcome_id IN ('4', '5')
      AND canonical_outcome IS NULL;
    RAISE NOTICE '[migration] backfill sptpub market 186 canonical OK';
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE '[migration] backfill sptpub 186 failed: %', SQLERRM;
END $$;


-- ─── VIEW: v_arb_live ───
-- Reference v_matched_pairs → phải đặt SAU v_matched_pairs (cùng schema block).
-- Nếu để trong SCHEMA_ODDS (chạy trước SCHEMA_POLYMARKET) sẽ lỗi undefined.
CREATE OR REPLACE VIEW v_arb_live AS
SELECT
    ao.id, ao.detected_at, ao.last_seen_at,
    (NOW() - ao.detected_at)                 AS duration,
    ao.canonical_match_id,
    cm.home_name, cm.away_name,
    cm.tournament_name, cm.scheduled_at,
    ao.direction,
    ROUND(ao.sptpub_odds::numeric, 3)        AS sptpub_odds,
    ROUND(ao.poly_odds::numeric, 3)          AS poly_odds,
    ROUND(ao.edge_percent::numeric, 3)       AS edge_pct,
    ROUND(ao.peak_edge_percent::numeric, 3)  AS peak_edge_pct,
    GREATEST(NOW() - ao.sptpub_updated_at,
             NOW() - ao.poly_updated_at)     AS max_staleness,
    cm.bet_url                               AS csgoempire_url,
    mp.polymarket_url
FROM odds.arb_opportunities ao
JOIN v_csgoempire_matches_full cm ON cm.match_id = ao.canonical_match_id
LEFT JOIN v_matched_pairs mp      ON mp.canonical_match_id = ao.canonical_match_id
WHERE ao.closed_at IS NULL
ORDER BY ao.edge_percent DESC;


-- ─── VIEW: v_arb_full ───
-- Fat view join ARB CORE với mọi bảng liên quan để debug/verify 1 arb row:
--   - match metadata + URL sptpub (từ v_csgoempire_matches_full)
--   - poly event/market/mapping metadata + URL poly
--   - live bid/ask CẢ 2 side poly (không chỉ side dùng trong arb)
--   - live decimal_odds CẢ 2 side sptpub
--   - quality flags: spread, max_staleness
-- Trả CẢ open lẫn closed arb — filter `WHERE closed_at IS NULL` khi cần.
CREATE OR REPLACE VIEW v_arb_full AS
SELECT
    -- ─── Arb core ───
    ao.id                                    AS arb_id,
    ao.detected_at,
    ao.last_seen_at,
    ao.closed_at,
    ao.closed_reason,
    (COALESCE(ao.closed_at, NOW()) - ao.detected_at)  AS duration,
    ao.direction,
    ao.sptpub_side,
    ao.poly_side,
    ROUND(ao.sptpub_odds::numeric, 3)        AS arb_sptpub_odds,
    ROUND(ao.poly_odds::numeric, 3)          AS arb_poly_odds,
    ROUND(ao.sum_inverse::numeric, 4)        AS sum_inverse,
    ROUND(ao.edge_percent::numeric, 3)       AS edge_pct,
    ROUND(ao.peak_edge_percent::numeric, 3)  AS peak_edge_pct,
    ao.sptpub_updated_at                     AS arb_sptpub_ts,
    ao.poly_updated_at                       AS arb_poly_ts,

    -- ─── Match metadata (sptpub SoT) ───
    ao.canonical_match_id,
    cm.home_name,
    cm.away_name,
    cm.sport_name,
    cm.tournament_name,
    cm.tournament_tier,
    cm.scheduled_at,
    cm.phase                                 AS match_phase,
    cm.ended_at,

    -- ─── Poly event + mapping ───
    mm.event_id                              AS poly_event_id,
    mm.confidence                            AS mapping_confidence,
    mm.method                                AS mapping_method,
    pe.slug                                  AS poly_slug,
    pe.title                                 AS poly_title,
    pe.league                                AS poly_league,
    pe.tournament                            AS poly_tournament,
    pe.live                                  AS poly_live_flag,
    pe.ended                                 AS poly_ended_flag,
    pe.pandascore_match_id,
    pe.grid_series_id,

    -- ─── Poly market (moneyline) ───
    pmk.condition_id                         AS poly_condition_id,
    pmk.home_token_id,
    pmk.away_token_id,
    pmk.outcomes                             AS poly_market_outcomes,
    pmk.accepting_orders                     AS poly_accepting_orders,

    -- ─── Live bid/ask CẢ 2 side poly (để verify vs arb frozen values) ───
    pmp_h.best_bid                           AS poly_home_bid_now,
    pmp_h.best_ask                           AS poly_home_ask_now,
    pmp_h.updated_at                         AS poly_home_price_ts,
    pmp_a.best_bid                           AS poly_away_bid_now,
    pmp_a.best_ask                           AS poly_away_ask_now,
    pmp_a.updated_at                         AS poly_away_price_ts,

    -- ─── Live sptpub odds CẢ 2 side (để verify vs arb frozen) ───
    oc_sh.decimal_odds                       AS sptpub_home_odds_now,
    oc_sh.updated_at                         AS sptpub_home_ts,
    oc_sa.decimal_odds                       AS sptpub_away_odds_now,
    oc_sa.updated_at                         AS sptpub_away_ts,

    -- ─── Quality signals ───
    (pmp_h.best_ask - pmp_h.best_bid)        AS poly_home_spread,
    (pmp_a.best_ask - pmp_a.best_bid)        AS poly_away_spread,
    GREATEST(NOW() - ao.sptpub_updated_at,
             NOW() - ao.poly_updated_at)     AS arb_max_staleness,

    -- ─── URLs ───
    cm.bet_url                               AS csgoempire_url,
    'https://polymarket.com/event/' || pe.slug  AS polymarket_url

FROM odds.arb_opportunities ao
LEFT JOIN v_csgoempire_matches_full cm
       ON cm.match_id = ao.canonical_match_id
LEFT JOIN polymarket.match_map mm
       ON mm.canonical_match_id = ao.canonical_match_id
LEFT JOIN polymarket.events pe
       ON pe.event_id = mm.event_id
LEFT JOIN polymarket.markets pmk
       ON pmk.event_id = mm.event_id AND pmk.market_type = 'moneyline'
LEFT JOIN polymarket.market_prices pmp_h
       ON pmp_h.condition_id = pmk.condition_id AND pmp_h.token_id = pmk.home_token_id
LEFT JOIN polymarket.market_prices pmp_a
       ON pmp_a.condition_id = pmk.condition_id AND pmp_a.token_id = pmk.away_token_id
LEFT JOIN odds.odds_current oc_sh
       ON oc_sh.platform = 'sptpub' AND oc_sh.match_id = ao.canonical_match_id
      AND oc_sh.canonical_market = 'winner' AND oc_sh.canonical_outcome = 'home'
LEFT JOIN odds.odds_current oc_sa
       ON oc_sa.platform = 'sptpub' AND oc_sa.match_id = ao.canonical_match_id
      AND oc_sa.canonical_market = 'winner' AND oc_sa.canonical_outcome = 'away';
"""


# Canonical outcome map cho sptpub (market_id, outcome_id) → (canonical_market, canonical_outcome).
# Chỉ include market đã verify từ HAR + market_descriptors:
#   186 = 2-way winner (esports, tennis single, cricket regular). Outcome 4=home, 5=away.
# 1x2 (market_id=1, outcomes 1/2/3) chưa add — cần schema 3-way (thêm 'draw'), defer.
# Racing/Outright markets skip vì không có tương ứng bên poly.
_SPTPUB_CANONICAL_MAP: dict = {
    ("186", "4"): ("winner", "home"),
    ("186", "5"): ("winner", "away"),
}


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
            await conn.execute(SCHEMA_ODDS)
            await conn.execute(SCHEMA_POLYMARKET)
            await conn.execute(SCHEMA_JOBS)

    async def close(self):
        if self.pool is not None:
            await self.pool.close()
            self.pool = None

    # ─────────────── STUB CREATORS (anonymous placeholder) ───────────────
    # Đảm bảo id tồn tại trước khi ghi row có FK trỏ tới. INSERT ... DO NOTHING
    # nên không đè lên record đã có thông tin đầy đủ.

    async def ensure_sport_stubs(self, ids) -> list:
        """Tạo stub cho các sport_id chưa tồn tại. RETURNING id chỉ trả về
        row thực sự được INSERT (không phải on-conflict-do-nothing) — dùng để
        log event 1 lần duy nhất cho mỗi id mới. Trả list new stubbed ids."""
        ids = [i for i in set(ids) if i]
        if not ids:
            return []
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch(
                "INSERT INTO sports (id) SELECT * FROM unnest($1::text[]) "
                "ON CONFLICT (id) DO NOTHING RETURNING id",
                ids,
            )
        new_stubs = [r["id"] for r in rows]
        if new_stubs:
            errlog.dump(
                "orphan_sport",
                OrphanReferenceEvent("sport", new_stubs),
                extra={"stubbed_ids": new_stubs, "count": len(new_stubs),
                       "note": "Betby ref sport_id không có trong sports{} — "
                               "stub đã tạo với name=NULL. Xem lại payload "
                               "để biết Betby có gửi bổ sung sau này không."},
            )
        return new_stubs

    async def ensure_category_stubs(self, ids) -> list:
        ids = [i for i in set(ids) if i]
        if not ids:
            return []
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch(
                "INSERT INTO categories (id) SELECT * FROM unnest($1::text[]) "
                "ON CONFLICT (id) DO NOTHING RETURNING id",
                ids,
            )
        new_stubs = [r["id"] for r in rows]
        if new_stubs:
            errlog.dump(
                "orphan_category",
                OrphanReferenceEvent("category", new_stubs),
                extra={"stubbed_ids": new_stubs, "count": len(new_stubs),
                       "note": "Betby ref category_id không có trong categories{} — "
                               "stub đã tạo với name=NULL."},
            )
        return new_stubs

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

    async def upsert_match(self, m: dict, phase: Optional[str] = None) -> bool:
        """Upsert match. Nếu match đã có `ended_at` (bị mark ended trước đó
        vì Betby ngừng phát tín hiệu — có thể là halftime, glitch, v.v.),
        CLEAR `ended_at` để tiếp tục nhận data. Trả True nếu vừa reactivate
        (caller có thể log).

        `phase` là hint từ caller ('live' | 'prematch'): live_loop luôn set
        'live'; prematch_loop set 'prematch' NHƯNG chỉ nếu phase cũ không
        phải 'live' (tránh demote match đang live). Nếu `phase=None`, không
        đụng vào cột phase.

        Rationale (option 2): Betby's "vắng mặt = ended" không đủ chính xác
        (10-20% false positive khi giữa hiệp). Thay vì thử đoán tín hiệu end
        thật, mình chấp nhận reactivate mỗi khi thấy data trở lại. Chỉ trận
        THẬT SỰ end mới không bao giờ reappear → ended_at giữ nguyên.
        """
        async with self._require_pool().acquire() as conn:
            row = await conn.fetchrow("""
                WITH old AS (SELECT ended_at FROM matches WHERE id = $1)
                INSERT INTO matches (id, sport_id, tournament_id, scheduled_at,
                                     virtual, slug, phase)
                VALUES ($1, $2, $3, to_timestamp($4), $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                    last_seen_at  = NOW(),
                    ended_at      = NULL,
                    sport_id      = COALESCE(EXCLUDED.sport_id,      matches.sport_id),
                    tournament_id = COALESCE(EXCLUDED.tournament_id, matches.tournament_id),
                    scheduled_at  = COALESCE(EXCLUDED.scheduled_at,  matches.scheduled_at),
                    phase         = CASE
                        WHEN EXCLUDED.phase IS NULL THEN matches.phase
                        -- 'live' luôn override (mọi phase khác)
                        WHEN EXCLUDED.phase = 'live' THEN 'live'
                        -- 'prematch' chỉ set nếu phase hiện tại không phải 'live'
                        WHEN EXCLUDED.phase = 'prematch' AND matches.phase IS DISTINCT FROM 'live'
                            THEN 'prematch'
                        ELSE matches.phase
                    END
                RETURNING COALESCE((SELECT ended_at IS NOT NULL FROM old), FALSE)
                          AS was_ended
            """,
                m["id"], m.get("sport_id"), m.get("tournament_id"),
                m.get("scheduled"), m.get("virtual", False), m.get("slug"),
                phase,
            )
            return bool(row and row["was_ended"])

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

    def _build_matches_where(self, *,
                             tournament=None, sport=None, phase=None,
                             virtual=None, team=None, has_odds=None,
                             since=None, until=None) -> tuple[str, list]:
        """Xây WHERE clause cho v_csgoempire_matches_full. Trả (where_sql, args).
        where_sql BẮT ĐẦU BẰNG ' WHERE ...' hoặc rỗng. Args là positional cho asyncpg."""
        args: list = []
        conds: list = []

        if tournament:
            args.append(tournament)
            conds.append(f"(tournament_id = ${len(args)} OR tournament_name ILIKE '%'||${len(args)}||'%')")
        if sport:
            args.append(sport)
            conds.append(f"(sport_id = ${len(args)} OR sport_slug = ${len(args)} OR sport_name ILIKE '%'||${len(args)}||'%')")
        if phase:
            if phase == "active":
                conds.append("phase IN ('live', 'prematch')")
            elif phase == "unknown":
                conds.append("phase IS NULL")
            else:
                args.append(phase)
                conds.append(f"phase = ${len(args)}")
        if virtual is not None:
            args.append(bool(virtual))
            conds.append(f"virtual = ${len(args)}")
        if team:
            args.append(team)
            conds.append(f"(home_name ILIKE '%'||${len(args)}||'%' OR away_name ILIKE '%'||${len(args)}||'%')")
        if since:
            args.append(since)
            conds.append(f"scheduled_at >= ${len(args)}::timestamptz")
        if until:
            args.append(until)
            conds.append(f"scheduled_at <= ${len(args)}::timestamptz")
        if has_odds:
            conds.append("EXISTS (SELECT 1 FROM odds.odds_current oc WHERE oc.match_id = v_csgoempire_matches_full.match_id)")

        where = (" WHERE " + " AND ".join(conds)) if conds else ""
        return where, args

    async def list_matches(self, tournament: Optional[str] = None,
                           sport: Optional[str] = None,
                           phase: Optional[str] = None,
                           virtual: Optional[bool] = None,
                           team: Optional[str] = None,
                           has_odds: Optional[bool] = None,
                           since: Optional[str] = None,
                           until: Optional[str] = None,
                           limit: int = 50):
        """Filter matches từ v_csgoempire_matches_full. Mọi filter optional, ANDed.

        - `tournament` / `sport`: match id hoặc slug (LIKE cả 2)
        - `phase`: 'live' | 'prematch' | 'ended' | 'active' (alias: live+prematch)
        - `virtual`: True/False
        - `team`: ILIKE trên home_name hoặc away_name
        - `has_odds`: True → chỉ trận có ≥1 row trong odds.odds_current
        - `since`/`until`: ISO timestamp lọc theo scheduled_at
        """
        where, args = self._build_matches_where(
            tournament=tournament, sport=sport, phase=phase,
            virtual=virtual, team=team, has_odds=has_odds,
            since=since, until=until,
        )
        args.append(int(limit))
        q = f"SELECT * FROM v_csgoempire_matches_full{where} ORDER BY last_seen_at DESC LIMIT ${len(args)}"
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch(q, *args)
            return [dict(r) for r in rows]

    async def count_matches(self, **filters) -> int:
        """SELECT count(*) với CÙNG filter như list_matches. Bỏ qua limit."""
        filters.pop("limit", None)
        where, args = self._build_matches_where(**filters)
        q = f"SELECT count(*) FROM v_csgoempire_matches_full{where}"
        async with self._require_pool().acquire() as conn:
            return int(await conn.fetchval(q, *args) or 0)

    async def get_stats(self) -> dict:
        """Overview cho command `stats`: count theo phase + odds/players/markets counts."""
        async with self._require_pool().acquire() as conn:
            # 1 query duy nhất — CTE + UNION ALL cho gọn
            row = await conn.fetchrow("""
                SELECT
                    (SELECT count(*) FROM matches)                                        AS matches_total,
                    (SELECT count(*) FROM matches WHERE phase = 'live')                    AS phase_live,
                    (SELECT count(*) FROM matches WHERE phase = 'prematch')                AS phase_prematch,
                    (SELECT count(*) FROM matches WHERE phase = 'ended')                   AS phase_ended,
                    (SELECT count(*) FROM matches WHERE phase IS NULL)                     AS phase_null,
                    (SELECT count(*) FROM matches WHERE virtual)                           AS virtual_count,
                    (SELECT count(*) FROM tournaments)                                     AS tournaments_count,
                    (SELECT count(*) FROM competitors)                                     AS competitors_count,
                    (SELECT count(*) FROM sports)                                          AS sports_count,
                    (SELECT count(*) FROM score_events)                                    AS score_events_count,
                    (SELECT count(*) FROM odds.odds_current)                               AS odds_current_count,
                    (SELECT count(*) FROM odds.odds_history)                               AS odds_history_count,
                    (SELECT count(*) FROM odds.market_descriptors)                         AS market_descriptors_count,
                    (SELECT count(*) FROM odds.players)                                    AS players_count,
                    (SELECT count(DISTINCT match_id) FROM odds.odds_current)               AS matches_with_odds,
                    (SELECT max(ts) FROM score_events)                                     AS last_score_ts,
                    (SELECT max(updated_at) FROM odds.odds_current)                        AS last_odds_ts
            """)
            return dict(row) if row else {}

    async def find_across(self, text: str, limit: int = 20) -> dict:
        """Full-search text ILIKE trên: matches (slug/home_name/away_name),
        tournaments (name/slug), players (name). Trả dict grouped."""
        pat = f"%{text}%"
        async with self._require_pool().acquire() as conn:
            matches = await conn.fetch("""
                SELECT match_id, slug, phase, home_name, away_name,
                       tournament_name, scheduled_at
                FROM v_csgoempire_matches_full
                WHERE slug ILIKE $1 OR home_name ILIKE $1 OR away_name ILIKE $1
                ORDER BY last_seen_at DESC
                LIMIT $2
            """, pat, limit)
            tournaments = await conn.fetch("""
                SELECT id, name, slug, tier
                FROM tournaments
                WHERE name ILIKE $1 OR slug ILIKE $1
                LIMIT $2
            """, pat, limit)
            players = await conn.fetch("""
                SELECT player_id, name, competitor_id
                FROM odds.players
                WHERE name ILIKE $1
                LIMIT $2
            """, pat, limit)
            return {
                "matches":     [dict(r) for r in matches],
                "tournaments": [dict(r) for r in tournaments],
                "players":     [dict(r) for r in players],
            }

    async def get_match(self, match_id: str):
        async with self._require_pool().acquire() as conn:
            r = await conn.fetchrow(
                "SELECT * FROM v_csgoempire_matches_full WHERE match_id = $1", match_id
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
                "UPDATE matches SET ended_at = NOW(), phase = 'ended' "
                "WHERE id=$1 AND ended_at IS NULL RETURNING id",
                match_id
            )
            return row is not None

    # ─────────────── ODDS (schema `odds`) ───────────────

    async def upsert_market_descriptors(self, platform: str, rows: list[dict]):
        """rows = [{id, name, market_type, specifiers[], variants{}}, ...]
        Từ điển market chung, gọi ~1h/lần. INSERT ... ON CONFLICT DO UPDATE."""
        if not rows:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO odds.market_descriptors
                    (platform, market_id, name_template, market_type, specifiers, variants)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                ON CONFLICT (platform, market_id) DO UPDATE SET
                    name_template = EXCLUDED.name_template,
                    market_type   = EXCLUDED.market_type,
                    specifiers    = EXCLUDED.specifiers,
                    variants      = EXCLUDED.variants,
                    updated_at    = NOW()
            """, [(platform, str(r["id"]), r.get("name"), r.get("market_type"),
                   r.get("specifiers") or [],
                   json.dumps(r.get("variants") or {})) for r in rows])

    async def upsert_status_labels(self, platform: str, mapping: dict):
        """{code_str: label} → INSERT/UPDATE per row."""
        if not mapping:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO odds.status_labels (platform, code, label)
                VALUES ($1, $2, $3)
                ON CONFLICT (platform, code) DO UPDATE SET
                    label = EXCLUDED.label, updated_at = NOW()
            """, [(platform, int(k), v) for k, v in mapping.items()
                   if str(k).lstrip('-').isdigit()])

    async def upsert_players(self, platform: str, rows: list[dict]):
        """rows = [{id, name, competitor_id}, ...]"""
        if not rows:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO odds.players (platform, player_id, name, competitor_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (platform, player_id) DO UPDATE SET
                    name          = COALESCE(NULLIF(EXCLUDED.name, ''), odds.players.name),
                    competitor_id = COALESCE(EXCLUDED.competitor_id, odds.players.competitor_id),
                    updated_at    = NOW()
            """, [(platform, r["id"], r.get("name"), r.get("competitor_id"))
                   for r in rows if r.get("id")])

    async def upsert_event_market_overrides(self, platform: str, match_id: str,
                                             rows: list[dict]):
        """rows = [{market_id, specifier_key, market_name, outcomes[]}, ...]
        Được extract từ /api/v3/descriptions/.../event/{id}/en."""
        if not rows:
            return
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO odds.event_market_overrides
                    (platform, match_id, market_id, specifier_key, market_name, outcomes)
                VALUES ($1, $2, $3, $4, $5, $6::jsonb)
                ON CONFLICT (platform, match_id, market_id, specifier_key) DO UPDATE SET
                    market_name = EXCLUDED.market_name,
                    outcomes    = EXCLUDED.outcomes,
                    updated_at  = NOW()
            """, [(platform, match_id, str(r["market_id"]), r["specifier_key"],
                   r.get("market_name"), json.dumps(r.get("outcomes") or []))
                  for r in rows])

    async def ingest_odds(self, platform: str, odds_rows: list[dict]):
        """odds_rows = [{match_id, market_id, specifier_key, outcome_id, decimal_odds}, ...]

        1) Đọc snapshot cũ (odds_current) → nếu giá thay đổi thì INSERT vào
           odds_history (dedup).
        2) UPSERT vào odds_current — kèm canonical_market/canonical_outcome
           cho các market được _SPTPUB_CANONICAL_MAP cover (VD 186 winner 2-way).

        Tính ở tầng ứng dụng (SELECT + so sánh) thay vì trigger → dễ tune,
        không phải maintain PL/pgSQL, log rõ khi có thay đổi."""
        if not odds_rows:
            return 0, 0
        # Enrich mỗi row với (canonical_market, canonical_outcome) qua lookup map.
        # Row không match → canonical = None (không phá schema, chỉ không tham gia arb).
        for r in odds_rows:
            key = (str(r["market_id"]), str(r["outcome_id"]))
            cm, co = _SPTPUB_CANONICAL_MAP.get(key, (None, None))
            r["_canonical_market"] = cm
            r["_canonical_outcome"] = co

        async with self._require_pool().acquire() as conn:
            async with conn.transaction():
                # 1) Snapshot cũ
                match_ids = list({r["match_id"] for r in odds_rows})
                cur_rows = await conn.fetch("""
                    SELECT match_id, market_id, specifier_key, outcome_id, decimal_odds
                    FROM odds.odds_current
                    WHERE platform=$1 AND match_id = ANY($2::text[])
                """, platform, match_ids)
                current = {(r["match_id"], r["market_id"], r["specifier_key"],
                            r["outcome_id"]): r["decimal_odds"] for r in cur_rows}

                # 2) Rows đổi giá → history
                changed = []
                for r in odds_rows:
                    key = (r["match_id"], r["market_id"], r["specifier_key"],
                           r["outcome_id"])
                    if current.get(key) != r["decimal_odds"]:
                        changed.append(r)

                # 3) INSERT history (kèm canonical để history join arb được)
                if changed:
                    await conn.executemany("""
                        INSERT INTO odds.odds_history
                            (ts, platform, match_id, market_id, specifier_key,
                             outcome_id, decimal_odds,
                             canonical_market, canonical_outcome)
                        VALUES (NOW(), $1, $2, $3, $4, $5, $6, $7, $8)
                    """, [(platform, r["match_id"], r["market_id"],
                           r["specifier_key"], r["outcome_id"], r["decimal_odds"],
                           r["_canonical_market"], r["_canonical_outcome"])
                          for r in changed])

                # 4) UPSERT current
                await conn.executemany("""
                    INSERT INTO odds.odds_current
                        (platform, match_id, market_id, specifier_key,
                         outcome_id, decimal_odds,
                         canonical_market, canonical_outcome, updated_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                    ON CONFLICT (platform, match_id, market_id, specifier_key, outcome_id)
                    DO UPDATE SET
                        decimal_odds      = EXCLUDED.decimal_odds,
                        canonical_market  = EXCLUDED.canonical_market,
                        canonical_outcome = EXCLUDED.canonical_outcome,
                        updated_at        = NOW()
                """, [(platform, r["match_id"], r["market_id"], r["specifier_key"],
                       r["outcome_id"], r["decimal_odds"],
                       r["_canonical_market"], r["_canonical_outcome"])
                      for r in odds_rows])

                return len(odds_rows), len(changed)

    async def fetch_match_id_by_slug(self, slug_with_id: str) -> Optional[str]:
        """Cắt match_id (số ≥15 chữ) ở đuôi slug: 'alliance-3dmax-2715306923066007564'
        → '2715306923066007564'. Verify tồn tại trong `matches`. Trả None nếu
        format sai hoặc match không có."""
        import re
        m = re.search(r"-(\d{15,})$", slug_with_id)
        if not m:
            return None
        mid = m.group(1)
        async with self._require_pool().acquire() as conn:
            r = await conn.fetchval("SELECT id FROM matches WHERE id=$1", mid)
            return r

    async def get_odds_for_match(self, platform: str, match_id: str) -> list[dict]:
        """Trả toàn bộ odds hiện tại của 1 match, JOIN với descriptor + override
        + player + team name → mỗi row đủ thông tin để hiển thị."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    oc.market_id,
                    oc.specifier_key,
                    oc.outcome_id,
                    oc.decimal_odds,
                    oc.updated_at,
                    md.name_template  AS market_template,
                    md.market_type,
                    md.specifiers     AS market_specifiers,
                    md.variants       AS market_variants,
                    emo.market_name   AS override_market_name,
                    emo.outcomes      AS override_outcomes
                FROM odds.odds_current oc
                LEFT JOIN odds.market_descriptors md
                       ON md.platform = oc.platform AND md.market_id = oc.market_id
                LEFT JOIN odds.event_market_overrides emo
                       ON emo.platform = oc.platform
                      AND emo.match_id = oc.match_id
                      AND emo.market_id = oc.market_id
                      AND emo.specifier_key = oc.specifier_key
                WHERE oc.platform=$1 AND oc.match_id=$2
                ORDER BY oc.market_id, oc.specifier_key, oc.outcome_id
            """, platform, match_id)
            return [dict(r) for r in rows]

    async def get_status_label(self, platform: str, code: Optional[int]) -> Optional[str]:
        if code is None:
            return None
        async with self._require_pool().acquire() as conn:
            return await conn.fetchval(
                "SELECT label FROM odds.status_labels WHERE platform=$1 AND code=$2",
                platform, int(code),
            )

    async def known_players(self, platform: str) -> set:
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch(
                "SELECT player_id FROM odds.players WHERE platform=$1", platform,
            )
            return {r["player_id"] for r in rows}


    # ─────────────── POLYMARKET TENANT ───────────────

    async def upsert_poly_events(self, rows: list[dict]) -> int:
        """rows: [{event_id, slug, title, sport, league, tournament, grid_series_id,
        pandascore_match_id, home_team, away_team, home_provider_id, away_provider_id,
        start_time (datetime), live, ended, closed, raw (dict)}]. Return số row processed."""
        if not rows:
            return 0
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO polymarket.events
                    (event_id, slug, title, sport, league, tournament,
                     grid_series_id, pandascore_match_id,
                     home_team, away_team, home_provider_id, away_provider_id,
                     start_time, live, ended, closed, raw, last_seen)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,NOW())
                ON CONFLICT (event_id) DO UPDATE SET
                    slug=EXCLUDED.slug, title=EXCLUDED.title, sport=EXCLUDED.sport,
                    league=EXCLUDED.league, tournament=EXCLUDED.tournament,
                    grid_series_id=EXCLUDED.grid_series_id,
                    pandascore_match_id=EXCLUDED.pandascore_match_id,
                    home_team=EXCLUDED.home_team, away_team=EXCLUDED.away_team,
                    home_provider_id=EXCLUDED.home_provider_id,
                    away_provider_id=EXCLUDED.away_provider_id,
                    start_time=EXCLUDED.start_time,
                    live=EXCLUDED.live, ended=EXCLUDED.ended, closed=EXCLUDED.closed,
                    raw=EXCLUDED.raw, last_seen=NOW()
            """, [(r["event_id"], r["slug"], r["title"], r.get("sport"),
                   r.get("league"), r.get("tournament"),
                   r.get("grid_series_id"), r.get("pandascore_match_id"),
                   r["home_team"], r["away_team"],
                   r.get("home_provider_id"), r.get("away_provider_id"),
                   r.get("start_time"), r["live"], r["ended"], r["closed"],
                   json.dumps(r["raw"])) for r in rows])
        return len(rows)

    async def upsert_poly_markets(self, rows: list[dict]) -> int:
        """rows: [{condition_id, event_id, market_id, market_type, group_title,
        outcomes (list[str]), clob_token_ids (list[str]), accepting_orders,
        end_date (datetime|None), raw (dict),
        home_token_id (str|None), away_token_id (str|None)}].

        home_token_id/away_token_id do poller compute — chọn 1 phần tử của
        clob_token_ids theo team name align. None nếu market không phải moneyline
        hoặc tên team không align."""
        if not rows:
            return 0
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO polymarket.markets
                    (condition_id, event_id, market_id, market_type, group_title,
                     outcomes, clob_token_ids, home_token_id, away_token_id,
                     accepting_orders, end_date, raw, last_seen)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,NOW())
                ON CONFLICT (condition_id) DO UPDATE SET
                    event_id=EXCLUDED.event_id, market_id=EXCLUDED.market_id,
                    market_type=EXCLUDED.market_type, group_title=EXCLUDED.group_title,
                    outcomes=EXCLUDED.outcomes, clob_token_ids=EXCLUDED.clob_token_ids,
                    home_token_id=EXCLUDED.home_token_id,
                    away_token_id=EXCLUDED.away_token_id,
                    accepting_orders=EXCLUDED.accepting_orders,
                    end_date=EXCLUDED.end_date, raw=EXCLUDED.raw, last_seen=NOW()
            """, [(r["condition_id"], r["event_id"], r["market_id"], r["market_type"],
                   r.get("group_title"), r["outcomes"], r["clob_token_ids"],
                   r.get("home_token_id"), r.get("away_token_id"),
                   r.get("accepting_orders"), r.get("end_date"),
                   json.dumps(r["raw"])) for r in rows])
        return len(rows)

    async def upsert_poly_match_map(self, event_id: str, canonical_match_id: str,
                                     confidence: float, method: str,
                                     match_details: Optional[dict] = None,
                                     verified_by: str = "auto") -> None:
        async with self._require_pool().acquire() as conn:
            await conn.execute("""
                INSERT INTO polymarket.match_map
                    (event_id, canonical_match_id, confidence, method,
                     match_details, verified_by, updated_at)
                VALUES ($1, $2, $3, $4, $5::jsonb, $6, NOW())
                ON CONFLICT (event_id) DO UPDATE SET
                    canonical_match_id = EXCLUDED.canonical_match_id,
                    confidence = EXCLUDED.confidence,
                    method = EXCLUDED.method,
                    match_details = EXCLUDED.match_details,
                    verified_by = EXCLUDED.verified_by,
                    updated_at = NOW()
            """, event_id, canonical_match_id, float(confidence), method,
                 json.dumps(match_details or {}), verified_by)

    async def upsert_poly_unmapped(self, event_id: str, reason: str,
                                    candidates: Optional[list] = None) -> None:
        """Buffer event chưa map. Auto-increment attempts nếu row đã có."""
        async with self._require_pool().acquire() as conn:
            await conn.execute("""
                INSERT INTO polymarket.unmapped_events
                    (event_id, reason, candidates, attempts, last_attempt)
                VALUES ($1, $2, $3::jsonb, 1, NOW())
                ON CONFLICT (event_id) DO UPDATE SET
                    reason = EXCLUDED.reason,
                    candidates = EXCLUDED.candidates,
                    attempts = polymarket.unmapped_events.attempts + 1,
                    last_attempt = NOW()
            """, event_id, reason, json.dumps(candidates or []))

    async def fetch_unmapped_with_event(self, limit: int = 200) -> list[dict]:
        """Lấy các row trong unmapped_events kèm data event tương ứng, để retry
        resolve. Bỏ event đã ended. Order theo attempts ASC (retry ít lần trước)
        rồi start_time ASC (event sớm nhất trước — đáng arb hơn).
        Chỉ trả các column cần cho matching.find_canonical_match()."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT pe.event_id, pe.sport, pe.home_team, pe.away_team,
                       pe.start_time, ue.attempts
                FROM polymarket.unmapped_events ue
                JOIN polymarket.events pe ON pe.event_id = ue.event_id
                WHERE NOT pe.ended
                  AND pe.start_time IS NOT NULL
                ORDER BY ue.attempts ASC, pe.start_time ASC
                LIMIT $1
            """, limit)
            return [dict(r) for r in rows]

    async def delete_poly_unmapped(self, event_id: str) -> None:
        """Xoá row khỏi buffer khi event đã map được (cleanup)."""
        async with self._require_pool().acquire() as conn:
            await conn.execute("DELETE FROM polymarket.unmapped_events WHERE event_id=$1",
                               event_id)

    async def find_candidate_matches(self, sport_name_like: str,
                                      start_time, tolerance_seconds: int = 900
                                      ) -> list[dict]:
        """Trả các sptpub match trong cửa sổ ±tolerance quanh start_time, filter
        theo sport (LIKE % match tên sport lấy từ public.sports). Bao gồm home
        và away name để caller so tên trong Python (không phải SQL). Nhẹ vì
        cửa sổ ±15 phút thường ra ≤ vài chục candidate."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT m.id, m.scheduled_at, s.name AS sport,
                       ch.name AS home_name, ca.name AS away_name,
                       ch.id   AS home_id,   ca.id   AS away_id
                FROM matches m
                LEFT JOIN sports s ON s.id = m.sport_id
                JOIN match_competitors mch ON mch.match_id = m.id AND mch.side='home'
                JOIN competitors ch ON ch.id = mch.competitor_id
                JOIN match_competitors mca ON mca.match_id = m.id AND mca.side='away'
                JOIN competitors ca ON ca.id = mca.competitor_id
                WHERE lower(coalesce(s.name, '')) LIKE lower($1)
                  AND m.scheduled_at IS NOT NULL
                  AND ABS(EXTRACT(EPOCH FROM (m.scheduled_at - $2))) <= $3
                  AND m.ended_at IS NULL
            """, sport_name_like, start_time, tolerance_seconds)
            return [dict(r) for r in rows]

    async def resolve_team_alias(self, sport: str, alias_norm: str) -> Optional[str]:
        """Trả canonical_norm nếu alias đã được ánh xạ; None nếu không."""
        async with self._require_pool().acquire() as conn:
            v = await conn.fetchval(
                "SELECT canonical_norm FROM team_aliases WHERE sport=$1 AND alias=$2",
                sport, alias_norm,
            )
            return v


    async def fetch_poly_ws_subscription_map(self) -> dict:
        """Build map {token_id: {canonical_match_id, condition_id, outcome_index}}
        cho các market moneyline đã map. WS ingestor subscribe theo token_id
        rồi lookup ngược qua map này để biết ghi vào canonical match nào."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT
                    pm.condition_id,
                    mm.canonical_match_id,
                    tok.token_id,
                    tok.ord - 1  AS outcome_index
                FROM polymarket.markets pm
                JOIN polymarket.match_map mm  ON mm.event_id = pm.event_id
                CROSS JOIN LATERAL unnest(pm.clob_token_ids) WITH ORDINALITY AS tok(token_id, ord)
                WHERE pm.market_type = 'moneyline'
                  AND (pm.end_date IS NULL OR pm.end_date > NOW() - INTERVAL '2 hours')
            """)
            return {
                r["token_id"]: {
                    "canonical_match_id": r["canonical_match_id"],
                    "condition_id": r["condition_id"],
                    "outcome_index": r["outcome_index"],
                }
                for r in rows
            }

    async def ingest_poly_prices(self, ticks: list[dict]) -> tuple[int, int]:
        """
        ticks = [{
            canonical_match_id, condition_id, token_id,
            best_bid: float|None, best_ask: float|None,
            source_ts: datetime|None,
        }]

        Ghi vào 3 nơi:
          1. polymarket.market_prices — raw bid/ask/last_trade (UPSERT).
          2. polymarket.price_history — chỉ INSERT khi (bid, ask) đổi.
          3. odds.odds_current — canonical decimal_odds=1/best_ask (UPSERT
             `platform='polymarket'`, match_id=canonical, market_id=condition_id,
             outcome_id=token_id). Bỏ qua nếu best_ask None/0.

        Trả (n_ticks_processed, n_history_inserted).
        """
        if not ticks:
            return 0, 0
        async with self._require_pool().acquire() as conn:
            async with conn.transaction():
                # (1) Snapshot cũ từ polymarket.market_prices để dedup history
                keys = list({(t["condition_id"], t["token_id"]) for t in ticks})
                cond_ids = list({k[0] for k in keys})
                cur_rows = await conn.fetch("""
                    SELECT condition_id, token_id, best_bid, best_ask
                    FROM polymarket.market_prices
                    WHERE condition_id = ANY($1::text[])
                """, cond_ids)
                current = {(r["condition_id"], r["token_id"]):
                           (r["best_bid"], r["best_ask"]) for r in cur_rows}

                changed = []
                for t in ticks:
                    key = (t["condition_id"], t["token_id"])
                    cur = current.get(key)
                    new = (t.get("best_bid"), t.get("best_ask"))
                    if cur is None or _pair_differs(cur, new):
                        changed.append(t)

                # (2) INSERT history cho các tick đổi giá
                if changed:
                    await conn.executemany("""
                        INSERT INTO polymarket.price_history
                            (ts, condition_id, token_id, best_bid, best_ask, source_ts)
                        VALUES (NOW(), $1, $2, $3, $4, $5)
                    """, [(t["condition_id"], t["token_id"],
                           t.get("best_bid"), t.get("best_ask"),
                           t.get("source_ts")) for t in changed])

                # (1) UPSERT polymarket.market_prices cho MỌI tick (giữ updated_at fresh)
                await conn.executemany("""
                    INSERT INTO polymarket.market_prices
                        (condition_id, token_id, best_bid, best_ask, source_ts, updated_at)
                    VALUES ($1, $2, $3, $4, $5, NOW())
                    ON CONFLICT (condition_id, token_id) DO UPDATE SET
                        best_bid   = EXCLUDED.best_bid,
                        best_ask   = EXCLUDED.best_ask,
                        source_ts  = EXCLUDED.source_ts,
                        updated_at = NOW()
                """, [(t["condition_id"], t["token_id"],
                       t.get("best_bid"), t.get("best_ask"),
                       t.get("source_ts")) for t in ticks])

                # (3) UPSERT canonical odds.odds_current — chỉ khi best_ask hợp lệ
                canonical_rows = [
                    t for t in ticks
                    if t.get("best_ask") and float(t["best_ask"]) > 0
                ]
                if canonical_rows:
                    # Lookup home/away_token_id cho các condition_id trong batch → biết
                    # tick.token_id thuộc side nào để set canonical_outcome.
                    cond_ids = list({t["condition_id"] for t in canonical_rows})
                    mk_rows = await conn.fetch("""
                        SELECT condition_id, home_token_id, away_token_id
                        FROM polymarket.markets
                        WHERE condition_id = ANY($1::text[])
                          AND market_type = 'moneyline'
                    """, cond_ids)
                    side_map = {}  # (condition_id, token_id) -> 'home' | 'away'
                    for r in mk_rows:
                        if r["home_token_id"]:
                            side_map[(r["condition_id"], r["home_token_id"])] = "home"
                        if r["away_token_id"]:
                            side_map[(r["condition_id"], r["away_token_id"])] = "away"

                    await conn.executemany("""
                        INSERT INTO odds.odds_current
                            (platform, match_id, market_id, specifier_key, outcome_id,
                             decimal_odds, canonical_market, canonical_outcome, updated_at)
                        VALUES ('polymarket', $1, $2, '', $3, $4, $5, $6, NOW())
                        ON CONFLICT (platform, match_id, market_id, specifier_key, outcome_id)
                        DO UPDATE SET
                            decimal_odds      = EXCLUDED.decimal_odds,
                            canonical_market  = EXCLUDED.canonical_market,
                            canonical_outcome = EXCLUDED.canonical_outcome,
                            updated_at        = NOW()
                    """, [(t["canonical_match_id"], t["condition_id"], t["token_id"],
                           1.0 / float(t["best_ask"]),
                           # canonical_market = 'winner' nếu là moneyline mapped, else None
                           "winner" if (t["condition_id"], t["token_id"]) in side_map else None,
                           side_map.get((t["condition_id"], t["token_id"])))
                          for t in canonical_rows])

                return len(ticks), len(changed)

    async def fetch_fresh_canonical_pairs(self, freshness_seconds: int) -> list[dict]:
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT match_id, canonical_outcome AS side,
                       platform, decimal_odds, updated_at
                FROM odds.odds_current
                WHERE canonical_market = 'winner'
                  AND canonical_outcome IN ('home', 'away')
                  AND platform IN ('sptpub', 'polymarket')
                  AND decimal_odds IS NOT NULL
                  AND decimal_odds > 0
                  AND updated_at > NOW() - make_interval(secs => $1)
            """, freshness_seconds)
            return [dict(r) for r in rows]

    async def fetch_all_open_arbs(self) -> list[dict]:
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT id, canonical_match_id, direction, edge_percent, peak_edge_percent
                FROM odds.arb_opportunities WHERE closed_at IS NULL
            """)
            return [dict(r) for r in rows]

    async def close_arbs(self, ids_reasons: list[tuple]) -> int:
        if not ids_reasons:
            return 0
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                UPDATE odds.arb_opportunities
                SET closed_at = NOW(), closed_reason = $2
                WHERE id = $1 AND closed_at IS NULL
            """, ids_reasons)
        return len(ids_reasons)

    async def touch_arbs(self, updates: list[tuple]) -> int:
        """updates = [(id, new_current_edge, sptpub_ts, poly_ts)]"""
        if not updates:
            return 0
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                UPDATE odds.arb_opportunities
                SET last_seen_at      = NOW(),
                    peak_edge_percent = GREATEST(peak_edge_percent, $2),
                    sptpub_updated_at = $3,
                    poly_updated_at   = $4
                WHERE id = $1 AND closed_at IS NULL
            """, updates)
        return len(updates)

    async def insert_arbs(self, rows: list[dict]) -> int:
        if not rows:
            return 0
        async with self._require_pool().acquire() as conn:
            await conn.executemany("""
                INSERT INTO odds.arb_opportunities
                    (canonical_match_id, direction, sptpub_side, poly_side,
                     sptpub_odds, poly_odds, sum_inverse,
                     edge_percent, peak_edge_percent,
                     sptpub_updated_at, poly_updated_at)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8,$9,$10)
            """, [(r["canonical_match_id"], r["direction"],
                   r["sptpub_side"], r["poly_side"],
                   r["sptpub_odds"], r["poly_odds"], r["sum_inverse"],
                   r["edge_percent"],
                   r["sptpub_updated_at"], r["poly_updated_at"])
                  for r in rows])
        return len(rows)


    async def fetch_match_teams(self, canonical_match_id: str) -> tuple:
        """Trả (home_name, away_name) từ sptpub SoT. None nếu không có match."""
        async with self._require_pool().acquire() as conn:
            row = await conn.fetchrow("""
                SELECT
                    (SELECT c.name FROM match_competitors mc
                     JOIN competitors c ON c.id = mc.competitor_id
                     WHERE mc.match_id=$1 AND mc.side='home') AS home_name,
                    (SELECT c.name FROM match_competitors mc
                     JOIN competitors c ON c.id = mc.competitor_id
                     WHERE mc.match_id=$1 AND mc.side='away') AS away_name
            """, canonical_match_id)
            if not row or not row["home_name"] or not row["away_name"]:
                return None
            return (row["home_name"], row["away_name"])

    async def fetch_poly_moneyline_markets_for_event(self, event_id: str) -> list[dict]:
        """Trả markets moneyline của 1 poly event với outcomes + clob_token_ids +
        home/away_token_id hiện tại (để dedup no-op UPDATE)."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT condition_id, outcomes, clob_token_ids,
                       home_token_id, away_token_id
                FROM polymarket.markets
                WHERE event_id = $1 AND market_type = 'moneyline'
            """, event_id)
            return [dict(r) for r in rows]

    async def fetch_all_mapped_events(self) -> list[tuple]:
        """Trả [(event_id, canonical_match_id), ...] của mọi mapping đã có."""
        async with self._require_pool().acquire() as conn:
            rows = await conn.fetch("""
                SELECT event_id, canonical_match_id FROM polymarket.match_map
            """)
            return [(r["event_id"], r["canonical_match_id"]) for r in rows]

    async def update_poly_market_tokens(self, condition_id: str,
                                         home_token_id: str,
                                         away_token_id: str) -> None:
        async with self._require_pool().acquire() as conn:
            await conn.execute("""
                UPDATE polymarket.markets
                SET home_token_id = $2, away_token_id = $3
                WHERE condition_id = $1
            """, condition_id, home_token_id, away_token_id)




def _pair_differs(cur: tuple, new: tuple) -> bool:
    """So sánh (bid, ask) tuple — None-safe, float-safe (ngưỡng 1e-9)."""
    for a, b in zip(cur, new):
        if a is None and b is None:
            continue
        if a is None or b is None:
            return True
        try:
            if abs(float(a) - float(b)) > 1e-9:
                return True
        except (TypeError, ValueError):
            return True
    return False

db = Database()
