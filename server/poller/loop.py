"""
Poller loops.

Chạy 4 async task song song trong 1 process:
  - live_loop        : poll /api/v4/live/... mỗi POLL_LIVE_SECONDS (mặc định 1s)
  - prematch_loop    : poll /api/v4/prematch/... mỗi POLL_PREMATCH_SECONDS (30s)
  - descriptors_loop : refresh market dict + statuses + per-event player names
  - status_loop      : heartbeat log mỗi 60s

Chia sẻ:
  - `db`, `client` (SptpubClient) — thread-safe qua asyncio
  - `seen_scores` — dict theo dõi state, mỗi loop có bản riêng để tránh race

sptpub public API không cần auth — không có JWT refresh, không có bootstrap.
"""
import asyncio
import logging
import time

from server.common.config import settings
from server.common.db import db
from server.common import errlog
from server.common.errlog import dump as errlog_dump
from server.poller.sptpub_client import SptpubClient
from server.poller.parser import (
    iter_matches, iter_score_events, iter_removed_ids,
    iter_sports, iter_categories, iter_tournaments,
    iter_competitors, iter_match_competitors, iter_period_scores_for,
    iter_market_odds, iter_matches_with_player_props,
    parse_market_descriptors, parse_event_descriptions,
    _events,
)

log = logging.getLogger("poller")


class PollerState:
    """Container cho state chia sẻ giữa 2 loop."""
    def __init__(self, client: SptpubClient):
        self.client = client
        self.stop = asyncio.Event()
        self.live_iter = 0
        self.prematch_iter = 0
        self.live_seen = 0
        self.prematch_seen = 0
        # match_id nào có player-props markets → descriptors_loop sẽ fetch
        # per-event descriptions cho những trận này (lookup tên player).
        # Cùng dict để track last-fetched-ts (0 = chưa fetch bao giờ).
        self.player_props_events: dict[str, float] = {}


async def _upsert_dimensions(payload: dict) -> None:
    """Upsert bulk sports/categories/tournaments/competitors trước khi
    ghi matches (matches FK vào sports/tournaments, match_competitors FK vào
    competitors, tournaments FK vào categories, categories FK vào sports)."""
    await db.upsert_sports(list(iter_sports(payload)))
    await db.upsert_categories(list(iter_categories(payload)))
    await db.upsert_tournaments(list(iter_tournaments(payload)))
    await db.upsert_competitors(list(iter_competitors(payload)))


async def _ingest_odds_and_track_props(payload: dict, state: "PollerState") -> tuple[int, int]:
    """Bóc markets từ payload → UPSERT odds_current + INSERT odds_history (dedup).
    Đồng thời track trận có player-props markets để descriptors_loop biết fetch.
    Return (touched, changed) — dùng cho log."""
    odds_rows = list(iter_market_odds(payload))
    touched, changed = await db.ingest_odds(state.client.platform, odds_rows)
    # Track player-props events (idempotent — chỉ set khi chưa có)
    for mid in iter_matches_with_player_props(payload):
        state.player_props_events.setdefault(mid, 0.0)
    return touched, changed


async def _process_live_payload(payload: dict, seen_scores: dict,
                                 state: "PollerState") -> tuple[int, int, int]:
    """Ghi dimensions + matches + m:n + score events + period_scores + odds.
    Return (m_count, m_new, s_new).
    Cũng xử lý match bị remove khỏi live view (events[id]: null)."""
    m_count = s_new = m_new = 0

    # Xử lý match bị remove
    for removed_mid in iter_removed_ids(payload):
        seen_scores.pop(removed_mid, None)
        was_marked = await db.mark_ended(removed_mid)
        if was_marked:
            log.info("[live] match ended: %s", removed_mid)

    # 1) Dimensions trước (FK dependency)
    await _upsert_dimensions(payload)

    # 2) Matches + m:n competitors
    # Cache event blob theo mid để tra period_scores khi score đổi
    blobs = _events(payload)
    for m in iter_matches(payload):
        reactivated = await db.upsert_match(m, phase="live")
        if reactivated:
            # Match từng ended → giờ có data lại. Có thể là false-positive
            # end (halftime/glitch) hoặc thật sự resume. Chỉ log — consumer
            # sau này có thể query `matches` với `ended_at IS NULL` để biết.
            log.info("[live] match REACTIVATED (was ended): %s", m["id"])
        if m["id"] not in seen_scores:
            m_new += 1
        m_count += 1
    await db.upsert_match_competitors(list(iter_match_competitors(payload)))

    # 3) Score events (dedup) + period_scores kèm theo
    for evt in iter_score_events(payload):
        mid = evt["match_id"]
        key = (evt["home_score"], evt["away_score"], evt["period"], evt["match_status"])
        if seen_scores.get(mid) == key:
            continue
        seen_scores[mid] = key
        await db.insert_score(evt)
        # Insert period_scores snapshot cùng NOW() với score_event
        periods = iter_period_scores_for(blobs.get(mid) or {})
        if periods:
            await db.insert_period_scores(mid, periods)
        s_new += 1

    # 4) Odds ingestion (piggy-back trên cùng payload)
    await _ingest_odds_and_track_props(payload, state)

    return m_count, m_new, s_new


async def _process_prematch_payload(payload: dict, seen_matches: set,
                                     state: "PollerState") -> tuple[int, int]:
    """Ghi dimensions + matches + m:n + odds từ prematch payload (chưa có score).
    Return (m_count, m_new)."""
    m_count = m_new = 0

    await _upsert_dimensions(payload)

    blobs = _events(payload)   # noqa: F841 — giữ để nhất quán với live path
    for m in iter_matches(payload):
        reactivated = await db.upsert_match(m, phase="prematch")
        if reactivated:
            log.info("[prematch] match REACTIVATED (was ended): %s", m["id"])
        if m["id"] not in seen_matches:
            m_new += 1
            seen_matches.add(m["id"])
        m_count += 1
    await db.upsert_match_competitors(list(iter_match_competitors(payload)))

    # Odds ingestion (piggy-back)
    await _ingest_odds_and_track_props(payload, state)

    return m_count, m_new


# ---------- 2 loop chính ----------

async def live_loop(state: PollerState):
    seen_scores: dict[str, tuple] = await db.last_scores_map()
    interval = settings.poll_live_seconds
    log.info("live_loop starting (interval=%.2fs, hydrated %d scores from DB)",
             interval, len(seen_scores))

    while not state.stop.is_set():
        state.live_iter += 1
        t0 = time.perf_counter()
        try:
            payload, snap = await state.client.poll_live()
            # Set context ngay khi có snap — mọi errlog.dump sâu bên trong
            # (ensure_stubs, DB errors, ...) tự pickup HAR + iteration info.
            errlog.set_context(
                request=snap.get("request"),
                response=snap.get("response"),
                extra={
                    "loop": "live",
                    "iteration": state.live_iter,
                    "cursor": state.client.last_version_live,
                    "seen_scores_count": len(seen_scores),
                },
            )
            if not payload:
                errlog.clear_context()
                await asyncio.sleep(interval)
                continue

            m_total, m_new, s_new = await _process_live_payload(payload, seen_scores, state)
            dt_ms = (time.perf_counter() - t0) * 1000
            state.live_seen = len(seen_scores)
            if s_new or m_new:
                log.info("[live] iter=%d matches=%d new_matches=%d new_scores=%d dt=%.0fms",
                         state.live_iter, m_total, m_new, s_new, dt_ms)
        except Exception as e:
            log.exception("[live] iter error: %s", e)
            # Context đã set ở trên → errlog_dump tự attach HAR + iter info
            errlog_dump("live_loop", e)
        finally:
            errlog.clear_context()
        await asyncio.sleep(interval)

    log.info("live_loop stopped")


async def prematch_loop(state: PollerState):
    seen_matches: set[str] = await db.known_match_ids()
    interval = settings.poll_prematch_seconds
    log.info("prematch_loop starting (interval=%.2fs, hydrated %d matches from DB)",
             interval, len(seen_matches))

    while not state.stop.is_set():
        state.prematch_iter += 1
        t0 = time.perf_counter()
        try:
            payload, snap = await state.client.poll_prematch()
            errlog.set_context(
                request=snap.get("request"),
                response=snap.get("response"),
                extra={
                    "loop": "prematch",
                    "iteration": state.prematch_iter,
                    "cursor": state.client.last_version_prematch,
                    "seen_matches_count": len(seen_matches),
                },
            )
            if not payload:
                errlog.clear_context()
                await asyncio.sleep(interval)
                continue

            m_total, m_new = await _process_prematch_payload(payload, seen_matches, state)
            dt_ms = (time.perf_counter() - t0) * 1000
            state.prematch_seen = len(seen_matches)
            if m_new:
                log.info("[prematch] iter=%d matches=%d new=%d dt=%.0fms",
                         state.prematch_iter, m_total, m_new, dt_ms)
        except Exception as e:
            log.exception("[prematch] iter error: %s", e)
            errlog_dump("prematch_loop", e)
        finally:
            errlog.clear_context()
        await asyncio.sleep(interval)

    log.info("prematch_loop stopped")


async def descriptors_loop(state: PollerState):
    """
    Loop chậm (mặc định 1h): refresh 2 từ điển bất biến trên sptpub.
      - /api/v3/descriptions/.../markets/en   → odds.market_descriptors
      - /api/v1/descriptions/statuses/en      → odds.status_labels
    Cộng thêm sub-loop nhanh hơn: quét state.player_props_events, fetch
    per-event descriptions (players + tên market đã render) cho trận đến
    tuổi refresh (poll_event_descriptions_seconds).
    """
    slow = settings.poll_descriptors_seconds
    per_event = settings.poll_event_descriptions_seconds

    async def _refresh_global():
        try:
            markets = await state.client.fetch_market_descriptors()
            if markets:
                rows = list(parse_market_descriptors(markets))
                await db.upsert_market_descriptors(state.client.platform, rows)
                log.info("[descriptors] market dict refreshed: %d markets", len(rows))
        except Exception as e:
            log.exception("[descriptors] market fetch failed: %s", e)
            errlog_dump("descriptors_market", e)
        try:
            statuses = await state.client.fetch_statuses()
            if statuses:
                await db.upsert_status_labels(state.client.platform, statuses)
                log.info("[descriptors] status dict refreshed: %d codes", len(statuses))
        except Exception as e:
            log.exception("[descriptors] status fetch failed: %s", e)
            errlog_dump("descriptors_status", e)

    async def _refresh_one_event(event_id: str):
        try:
            payload = await state.client.fetch_event_descriptions(event_id)
            if not payload:
                return
            players, overrides = parse_event_descriptions(payload)
            if players:
                await db.upsert_players(state.client.platform, players)
            if overrides:
                await db.upsert_event_market_overrides(
                    state.client.platform, event_id, overrides,
                )
            log.info("[descriptors] event=%s players=%d overrides=%d",
                     event_id, len(players), len(overrides))
        except Exception as e:
            log.warning("[descriptors] event=%s fetch failed: %s", event_id, e)
            errlog_dump("descriptors_event", e,
                        extra={"event_id": event_id})

    # Boot: refresh global immediately (khi database vẫn còn trống).
    await _refresh_global()
    last_global = time.time()

    while not state.stop.is_set():
        # Tick nhanh — 5s — kiểm tra per-event và global.
        await asyncio.sleep(5.0)
        now = time.time()

        # Global refresh
        if now - last_global >= slow:
            await _refresh_global()
            last_global = now

        # Per-event: fetch tối đa 3 trận/tick để không dồn burst.
        due = [mid for mid, ts in state.player_props_events.items()
               if now - ts >= per_event]
        for mid in due[:3]:
            await _refresh_one_event(mid)
            state.player_props_events[mid] = time.time()

    log.info("descriptors_loop stopped")


async def status_loop(state: PollerState):
    """Heartbeat mỗi 60s: chỉ log (không publish, đã bỏ Redis)."""
    while not state.stop.is_set():
        await asyncio.sleep(60)
        log.info("heartbeat live=%d/%d prematch=%d/%d",
                 state.live_iter, state.live_seen,
                 state.prematch_iter, state.prematch_seen)


# ---------- entry ----------

async def run_poller():
    log.info("Poller starting. live=%s(%.2fs) prematch=%s(%.2fs) brand=%s",
             "ON" if settings.poll_live_enabled else "OFF",
             settings.poll_live_seconds,
             "ON" if settings.poll_prematch_enabled else "OFF",
             settings.poll_prematch_seconds,
             settings.sptpub_brand_id)

    await db.connect()
    log.info("DB connected")

    client = SptpubClient(
        brand_id=settings.sptpub_brand_id,
        base_url=settings.sptpub_base,
        user_agent=settings.sptpub_user_agent,
    )
    state = PollerState(client)

    # Build task list theo flag — chỉ include loop được bật.
    # descriptors_loop + status_loop luôn bật (rẻ, chỉ log/heartbeat).
    tasks = [descriptors_loop(state), status_loop(state)]
    if settings.poll_live_enabled:
        tasks.append(live_loop(state))
    else:
        log.info("live_loop DISABLED (POLL_LIVE_ENABLED=false)")
    if settings.poll_prematch_enabled:
        tasks.append(prematch_loop(state))
    else:
        log.info("prematch_loop DISABLED (POLL_PREMATCH_ENABLED=false)")

    try:
        await asyncio.gather(*tasks)
    finally:
        state.stop.set()
        await client.close()
        await db.close()
        log.info("Poller stopped.")
