"""
Poller loops (phase 1).

Chạy 2 async task song song trong 1 process:
  - live_loop      : poll /api/v4/live/... mỗi POLL_LIVE_SECONDS (mặc định 1s)
  - prematch_loop  : poll /api/v4/prematch/... mỗi POLL_PREMATCH_SECONDS (30s)

Chia sẻ:
  - `db`, `bus`, `client` (SptpubClient) — thread-safe qua asyncio
  - `seen_scores` — dict theo dõi state, mỗi loop có bản riêng để tránh race
  - `auth` — refresh JWT có lock để 2 loop không refresh đồng thời
"""
import asyncio
import logging
import time
from datetime import datetime, timezone

from server.common.config import settings
from server.common.db import db
from server.common import errlog
from server.common.errlog import dump as errlog_dump
from server.common.redis_bus import (
    bus, CH_SCORES, CH_MATCHES, CH_MATCH_ENDED, CH_MATCH_REOPENED, CH_STATUS,
)
from server.poller.auth import AuthClient
from server.poller.sptpub_client import SptpubClient
from server.poller.parser import (
    iter_matches, iter_score_events, iter_removed_ids,
    iter_sports, iter_categories, iter_tournaments,
    iter_competitors, iter_match_competitors, iter_period_scores_for,
    _events,
)

log = logging.getLogger("poller")


class PollerState:
    """Container cho state chia sẻ giữa 2 loop."""
    def __init__(self, auth: AuthClient, client: SptpubClient):
        self.auth = auth
        self.client = client
        self.refresh_lock = asyncio.Lock()
        self.stop = asyncio.Event()
        self.live_iter = 0
        self.prematch_iter = 0
        self.live_seen = 0
        self.prematch_seen = 0

    async def refresh_if_needed(self, response_status: int) -> bool:
        """Gọi khi gặp 401/403. Refresh JWT có lock để tránh song song."""
        if response_status not in (401, 403):
            return False
        async with self.refresh_lock:
            try:
                await self.auth.refresh_betby()
                return True
            except Exception as e:
                log.error("refresh_betby failed: %s", e)
                self.stop.set()
                return False


async def _upsert_dimensions(payload: dict) -> None:
    """Upsert bulk sports/categories/tournaments/competitors trước khi
    ghi matches (matches FK vào sports/tournaments, match_competitors FK vào
    competitors, tournaments FK vào categories, categories FK vào sports)."""
    await db.upsert_sports(list(iter_sports(payload)))
    await db.upsert_categories(list(iter_categories(payload)))
    await db.upsert_tournaments(list(iter_tournaments(payload)))
    await db.upsert_competitors(list(iter_competitors(payload)))


async def _process_live_payload(payload: dict, seen_scores: dict) -> tuple[int, int, int]:
    """Ghi dimensions + matches + m:n + score events + period_scores.
    Return (m_count, m_new, s_new).
    Cũng xử lý match bị remove khỏi live view (events[id]: null)."""
    m_count = s_new = m_new = 0

    # Xử lý match bị remove
    for removed_mid in iter_removed_ids(payload):
        seen_scores.pop(removed_mid, None)
        was_marked = await db.mark_ended(removed_mid)
        if was_marked:
            await bus.publish(CH_MATCH_ENDED, {
                "match_id": removed_mid,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
            log.info("[live] match ended: %s", removed_mid)

    # 1) Dimensions trước (FK dependency)
    await _upsert_dimensions(payload)

    # 2) Matches + m:n competitors
    # Cache event blob theo mid để tra period_scores khi score đổi
    blobs = _events(payload)
    for m in iter_matches(payload):
        reactivated = await db.upsert_match(m)
        if reactivated:
            # Match từng ended → giờ có data lại. Có thể là false-positive
            # end (halftime/glitch) hoặc thật sự resume. Log + publish để
            # consumer downstream (Slack bot, dashboard) tự quyết định.
            log.info("[live] match REACTIVATED (was ended): %s", m["id"])
            await bus.publish(CH_MATCH_REOPENED, {
                "match_id": m["id"],
                "ts": datetime.now(timezone.utc).isoformat(),
                "source": "live",
            })
        if m["id"] not in seen_scores:
            m_new += 1
            # Tra tên home/away từ blob để publish (không lưu vào matches nữa)
            desc = (blobs.get(m["id"]) or {}).get("desc") or {}
            comps = desc.get("competitors") or []
            await bus.publish(CH_MATCHES, {
                "match_id": m["id"],
                "home": (comps[0].get("name") if len(comps) > 0 else None),
                "away": (comps[1].get("name") if len(comps) > 1 else None),
                "sport_id": m["sport_id"],
                "tournament_id": m["tournament_id"],
                "source": "live",
            })
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
        await bus.publish(CH_SCORES, {
            "match_id": mid,
            "home_score": evt["home_score"], "away_score": evt["away_score"],
            "period": evt["period"], "match_status": evt["match_status"],
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        s_new += 1

    return m_count, m_new, s_new


async def _process_prematch_payload(payload: dict, seen_matches: set) -> tuple[int, int]:
    """Ghi dimensions + matches + m:n từ prematch payload (chưa có score).
    Return (m_count, m_new)."""
    m_count = m_new = 0

    await _upsert_dimensions(payload)

    blobs = _events(payload)
    for m in iter_matches(payload):
        reactivated = await db.upsert_match(m)
        if reactivated:
            log.info("[prematch] match REACTIVATED (was ended): %s", m["id"])
            await bus.publish(CH_MATCH_REOPENED, {
                "match_id": m["id"],
                "ts": datetime.now(timezone.utc).isoformat(),
                "source": "prematch",
            })
        if m["id"] not in seen_matches:
            m_new += 1
            seen_matches.add(m["id"])
            desc = (blobs.get(m["id"]) or {}).get("desc") or {}
            comps = desc.get("competitors") or []
            await bus.publish(CH_MATCHES, {
                "match_id": m["id"],
                "home": (comps[0].get("name") if len(comps) > 0 else None),
                "away": (comps[1].get("name") if len(comps) > 1 else None),
                "sport_id": m["sport_id"],
                "tournament_id": m["tournament_id"],
                "scheduled": m.get("scheduled"),
                "source": "prematch",
            })
        m_count += 1
    await db.upsert_match_competitors(list(iter_match_competitors(payload)))
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

            m_total, m_new, s_new = await _process_live_payload(payload, seen_scores)
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

            m_total, m_new = await _process_prematch_payload(payload, seen_matches)
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


async def status_loop(state: PollerState):
    """Heartbeat mỗi 60s: log + publish Redis."""
    while not state.stop.is_set():
        await asyncio.sleep(60)
        log.info("heartbeat live=%d/%d prematch=%d/%d",
                 state.live_iter, state.live_seen,
                 state.prematch_iter, state.prematch_seen)
        try:
            await bus.publish(CH_STATUS, {
                "live_iter": state.live_iter, "live_seen": state.live_seen,
                "prematch_iter": state.prematch_iter, "prematch_seen": state.prematch_seen,
                "ts": datetime.now(timezone.utc).isoformat(),
            })
        except Exception:
            pass


# ---------- entry ----------

async def run_poller():
    log.info("Poller starting. live=%.2fs prematch=%.2fs brand=%s",
             settings.poll_live_seconds, settings.poll_prematch_seconds,
             settings.csgo_brand_id)

    await db.connect()
    await bus.connect()
    log.info("DB + Redis connected")

    auth = AuthClient()
    try:
        await auth.bootstrap()
        log.info("Bootstrap OK.")
    except Exception as e:
        log.error("Bootstrap failed: %s", e)
        log.error("Sleeping 30s before exit để tránh hammering server.")
        await auth.close()
        await bus.close()
        await db.close()
        await asyncio.sleep(30)
        return

    client = SptpubClient(auth.sptpub, settings.csgo_brand_id, settings.sptpub_base)
    state = PollerState(auth, client)

    try:
        await asyncio.gather(
            live_loop(state),
            prematch_loop(state),
            status_loop(state),
        )
    finally:
        state.stop.set()
        await auth.close()
        await bus.close()
        await db.close()
        log.info("Poller stopped.")
