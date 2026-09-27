"""
Polymarket poller — fetch active CS2 events từ gamma-api, upsert vào
`polymarket.events` / `polymarket.markets`, và cố ghép mỗi event với
canonical match trong `public.matches`. Mapping thành công → ghi
`polymarket.match_map`; không → ghi `polymarket.unmapped_events`.

Poly public read API không cần auth (verified qua HAR, xem
docs/platforms/polymarket.md). Chỉ cần User-Agent + Origin để qua CORS.

Chạy 1 shot rồi thoát; nếu muốn periodic, dùng cron ở tầng ngoài (systemd
timer, docker healthcheck, hoặc `while true; do ...; sleep 60; done`).

Chạy:
    python -m server.poller.polymarket                       # prematch 7 ngày tới, CS2
    python -m server.poller.polymarket --window-hours 3      # 3 giờ tới
    python -m server.poller.polymarket --limit 20            # 20 event
    python -m server.poller.polymarket --dump-only           # KHÔNG ghi DB, dump JSON
    python -m server.poller.polymarket --sport cs2

Flags:
    --sport         Sport tag (mặc định cs2). Xem SPORT_TAG_IDS.
    --limit N       Số event tối đa (mặc định 100).
    --window-hours  Cửa sổ prematch từ NOW → NOW+H (mặc định 168 = 7 ngày).
    --dump-only     Bỏ qua DB, chỉ dump JSON vào dumps/polymarket/ (debug).
    --out-dir       Thư mục dump (mặc định dumps/polymarket).
"""
import argparse
import asyncio
import time
import json
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional

from curl_cffi.requests import AsyncSession

from server.common.config import settings
from server.common.db import db
from server.common.matching import find_canonical_match, normalize_team_name

log = logging.getLogger("poller.polymarket")

GAMMA_BASE = "https://gamma-api.polymarket.com"

# tag_id trên polymarket. Extract từ HAR (docs/platforms/polymarket.md §4.1).
#   64      = "Esports" (parent) — bắt tất cả esport, mỗi event tự declare
#             sport qua `event.sport.sport` (cs2, dota2, lol, valorant, ...)
#   100780  = "counter strike 2" (narrow)
# Default fetch tag Esports; --sport <name> filter thêm ở tầng client sau khi
# response về (không dùng thêm tag_id để tránh phải maintain danh sách).
SPORT_TAG_IDS = {
    "all":   64,
    "cs2":   100780,
    # Narrow tag khác thêm khi có nhu cầu:
    # 'dota2': ...,   # extract từ HAR /events?tag_id=... khi tìm được
    # 'lol':   ...,
    # 'valorant': ...,
}

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0"
    ),
    "Origin":  "https://polymarket.com",
    "Referer": "https://polymarket.com/",
    "Accept":  "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
}


async def fetch_keyset(http: AsyncSession, sport: str, page_size: int,
                       window_hours: int, lookback_hours: int = 6,
                       max_pages: int = 20) -> dict:
    """GET /events/keyset — fetch cả prematch (chưa start) và live (đang chạy).

    Cửa sổ: [NOW - lookback_hours, NOW + window_hours]. Lookback 6h cover
    live BO5 esports có thể kéo dài vài giờ. Post-filter chỉ drop `ended`,
    giữ live để phase 2 arb có catalog.

    Follow `next_cursor` để phân trang. `max_pages` = safety cap (20 pages =
    2000 events). CS2+LoL+Valorant tuần hiếm khi > 1500 event, đủ dư.

    Trả về dict với events đã merge từ tất cả page + post-filter (drop ended).
    """
    now = datetime.now(timezone.utc)
    start = now - timedelta(hours=lookback_hours)
    end = now + timedelta(hours=window_hours)
    tag = SPORT_TAG_IDS[sport]
    base_params = {
        "tag_id": str(tag),
        "active": "true",
        "closed": "false",
        "limit": str(page_size),
        "order": "startTime",
        "ascending": "true",
        # Cửa sổ [now-lookback, now+window]. Không dùng start_time_max vì poly
        # cắt kỳ cục khi cả 2 min/max cùng có mặt — chỉ set start_time_min và
        # post-filter cận trên.
        "start_time_min": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
    }
    url = f"{GAMMA_BASE}/events/keyset"
    log.info("GET %s tag=%s window=[-%dh, +%dh] page_size=%d",
             url, tag, lookback_hours, window_hours, page_size)

    all_events: list = []
    cursor: str | None = None
    first_url: str = ""
    for page_i in range(1, max_pages + 1):
        params = dict(base_params)
        if cursor:
            params["after_cursor"] = cursor
        r = await http.get(url, params=params)
        r.raise_for_status()
        if page_i == 1:
            first_url = str(r.url)
        body = r.json()
        events = body.get("events", []) if isinstance(body, dict) else []
        all_events.extend(events)
        next_cursor = body.get("next_cursor") if isinstance(body, dict) else None
        log.info("  page %d: %d events, next_cursor=%s",
                 page_i, len(events), (next_cursor[:20] + "...") if next_cursor else "None")
        # Poly's next_cursor conventions:
        #   - Missing / None / "" / "LTE=" (base64 empty) → hết trang
        if not next_cursor or next_cursor in ("LTE=", ""):
            break
        cursor = next_cursor
    else:
        log.warning("keyset paging đạt max_pages=%d, có thể còn event chưa fetch",
                    max_pages)

    # Post-filter: drop 'ended', GIỮ 'live' (catalog cho phase 2 arb).
    # `startTime` phải <= now+window (không nhận event xa hơn tương lai vì
    # start_time_max không đáng tin bên poly). Không có cận dưới ở client
    # vì start_time_min đã handle server-side (rộng hơn: -lookback_hours).
    max_ts = end.timestamp()
    events_filtered = [
        e for e in all_events
        if not e.get("ended")
        and _parse_iso(e.get("startTime")) is not None
        and _parse_iso(e["startTime"]).timestamp() <= max_ts
    ]
    live_count = sum(1 for e in events_filtered if e.get("live"))
    prematch_count = len(events_filtered) - live_count
    log.info("keyset total: %d raw across %d pages → %d kept (%d prematch + %d live)",
             len(all_events), page_i, len(events_filtered), prematch_count, live_count)
    return {
        "url": first_url,
        "status": 200,
        "body_raw": {"pages": page_i, "raw_count": len(all_events)},
        "events": events_filtered,
    }


def _parse_iso(ts: Optional[str]) -> Optional[datetime]:
    """'2026-09-25T10:40:00Z' → datetime UTC. Trả None nếu parse fail."""
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00"))
    except Exception:
        return None


def _extract_event_row(ev: dict) -> Optional[dict]:
    """Chuyển 1 event JSON của poly thành row cho polymarket.events.
    Trả None nếu event thiếu field bắt buộc (2 teams)."""
    teams = ev.get("teams") or []
    if len(teams) < 2:
        return None
    home = next((t for t in teams if t.get("ordering") == "home"), None)
    away = next((t for t in teams if t.get("ordering") == "away"), None)
    if not home:
        home = teams[0]
    if not away:
        away = teams[1] if len(teams) > 1 else None
    if not away:
        return None
    em = ev.get("eventMetadata") or {}
    sport_obj = ev.get("sport") or {}
    return {
        "event_id":            str(ev["id"]),
        "slug":                ev.get("slug") or "",
        "title":               ev.get("title") or "",
        "sport":               sport_obj.get("sport"),
        "league":              em.get("league"),
        "tournament":          em.get("tournament"),
        "grid_series_id":      em.get("gridSeriesId"),
        "pandascore_match_id": em.get("pandascoreMatchId"),
        "home_team":           home.get("name") or "",
        "away_team":           away.get("name") or "",
        "home_provider_id":    home.get("providerId"),
        "away_provider_id":    away.get("providerId"),
        "start_time":          _parse_iso(ev.get("startTime")),
        "live":                bool(ev.get("live")),
        "ended":               bool(ev.get("ended")),
        "closed":              bool(ev.get("closed")),
        "raw":                 ev,
    }


def _extract_market_rows(ev: dict) -> list[dict]:
    """Chuyển markets của 1 event thành rows cho polymarket.markets.
    Bỏ market thiếu conditionId hoặc clobTokenIds.
    Với market moneyline: compute home_token_id / away_token_id bằng cách so
    outcomes[i] (tên team) với event.home_team / away_team (đã normalize).
    Nếu không align (VD tên team viết khác giữa moneyline outcomes và teams[]):
    2 cột NULL, market vẫn upsert nhưng không tham gia arb."""
    out = []
    for m in ev.get("markets") or []:
        cid = m.get("conditionId")
        if not cid:
            continue
        try:
            outcomes = json.loads(m["outcomes"]) if isinstance(m.get("outcomes"), str) else m.get("outcomes") or []
            clob_ids = json.loads(m["clobTokenIds"]) if isinstance(m.get("clobTokenIds"), str) else m.get("clobTokenIds") or []
        except (ValueError, KeyError):
            continue
        if not outcomes or not clob_ids:
            continue

        outcomes_str = [str(o) for o in outcomes]
        clob_str = [str(t) for t in clob_ids]

        # KHÔNG compute home/away_token_id ở đây nữa (bug: poly's ordering ≠ sptpub's).
        # _sync_canonical_tokens_for_event() làm sau khi có canonical_match_id từ
        # mapping — dùng sptpub home/away làm ground truth.
        home_tok, away_tok = None, None

        out.append({
            "condition_id":     cid,
            "event_id":         str(ev["id"]),
            "market_id":        str(m.get("id") or ""),
            "market_type":      m.get("sportsMarketType") or "unknown",
            "group_title":      m.get("groupItemTitle"),
            "outcomes":         outcomes_str,
            "clob_token_ids":   clob_str,
            "home_token_id":    home_tok,
            "away_token_id":    away_tok,
            "accepting_orders": m.get("acceptingOrders"),
            "end_date":         _parse_iso(m.get("endDate")),
            "raw":              m,
        })
    return out


async def _sync_canonical_tokens_for_event(event_id: str,
                                            canonical_match_id: str) -> int:
    """Sau khi event map thành công, compute home/away_token_id cho moneyline
    markets dựa vào canonical home/away (sptpub SoT) — KHÔNG dùng poly's
    event.teams[].ordering (có thể lệch giữa 2 nền tảng).

    Idempotent: chỉ UPDATE nếu giá trị khác. Return số market đã update.
    """
    team_names = await db.fetch_match_teams(canonical_match_id)
    if not team_names:
        return 0
    home_name, away_name = team_names
    home_norm = normalize_team_name(home_name)
    away_norm = normalize_team_name(away_name)
    if not home_norm or not away_norm:
        return 0

    markets = await db.fetch_poly_moneyline_markets_for_event(event_id)
    updated = 0
    for m in markets:
        outcomes = m["outcomes"] or []
        clob_ids = m["clob_token_ids"] or []
        if len(outcomes) != 2 or len(clob_ids) != 2:
            continue
        oc_norms = [normalize_team_name(o) for o in outcomes]

        home_tok, away_tok = None, None
        if home_norm in oc_norms:
            idx = oc_norms.index(home_norm)
            home_tok = clob_ids[idx]
            away_tok = clob_ids[1 - idx]
        elif away_norm in oc_norms:
            idx = oc_norms.index(away_norm)
            away_tok = clob_ids[idx]
            home_tok = clob_ids[1 - idx]
        else:
            log.warning("[sync-token] event=%s market=%s outcomes=%s KHÔNG match "
                        "canonical home=%r away=%r",
                        event_id, m["condition_id"][:16], outcomes, home_name, away_name)
            continue

        # Chỉ UPDATE khi khác (tránh no-op)
        if m.get("home_token_id") != home_tok or m.get("away_token_id") != away_tok:
            await db.update_poly_market_tokens(m["condition_id"], home_tok, away_tok)
            updated += 1
    return updated


async def try_resolve(ev_row: dict) -> tuple[str, Optional[dict]]:
    """
    Trả (status, details) — status ∈ {'mapped', 'unmapped'}.
    Ghi vào match_map hoặc unmapped_events tương ứng.
    """
    sport = ev_row.get("sport") or "cs2"
    if not ev_row.get("start_time"):
        await db.upsert_poly_unmapped(ev_row["event_id"], "no_start_time")
        return ("unmapped", {"reason": "no_start_time"})
    result = await find_canonical_match(
        db, sport,
        ev_row["home_team"], ev_row["away_team"],
        ev_row["start_time"],
    )
    if result is None:
        # Xây candidates preview cho user duyệt tay
        # (chỉ log lightweight — full candidate list quá to)
        await db.upsert_poly_unmapped(ev_row["event_id"], "no_match_found")
        return ("unmapped", {"reason": "no_match_found"})
    canonical_id, confidence, method, details = result
    await db.upsert_poly_match_map(
        ev_row["event_id"], canonical_id,
        confidence=confidence, method=method,
        match_details=details, verified_by="auto",
    )
    # Cleanup: xoá khỏi buffer unmapped nếu trước đó đã bị đánh dấu
    await db.delete_poly_unmapped(ev_row["event_id"])
    # Sync canonical home/away tokens cho moneyline markets của event này
    await _sync_canonical_tokens_for_event(ev_row["event_id"], canonical_id)
    return ("mapped", {"canonical": canonical_id, "confidence": confidence,
                       "method": method})


async def _retry_unmapped(limit: int = 200) -> tuple[int, int]:
    """Scan polymarket.unmapped_events, retry resolve cho event chưa map.
    Không HTTP call — đọc từ polymarket.events (đã upsert phase trước).
    Trả (n_retried, n_newly_mapped)."""
    rows = await db.fetch_unmapped_with_event(limit=limit)
    if not rows:
        return (0, 0)
    newly_mapped = 0
    for r in rows:
        sport = r.get("sport") or "cs2"
        result = await find_canonical_match(
            db, sport,
            r["home_team"], r["away_team"], r["start_time"],
        )
        if result is None:
            continue
        canonical_id, confidence, method, details = result
        await db.upsert_poly_match_map(
            r["event_id"], canonical_id,
            confidence=confidence, method=method,
            match_details=details, verified_by="auto:retry",
        )
        await db.delete_poly_unmapped(r["event_id"])
        newly_mapped += 1
        log.info("[retry] event=%s %s vs %s → %s (%s, conf=%.2f)",
                 r["event_id"], r["home_team"][:15], r["away_team"][:15],
                 canonical_id, method, confidence)
    return (len(rows), newly_mapped)


async def _run_once(sport: str, limit: int, window_hours: int, dump_only: bool,
                     out_dir: str) -> tuple[int, int, int]:
    """Một cycle fetch → upsert → resolve. Trả (n_events, n_mapped, n_unmapped)."""
    http = AsyncSession(impersonate="chrome131", headers=_HEADERS, timeout=20)
    try:
        keyset = await fetch_keyset(http, sport, page_size=limit, window_hours=window_hours)
    finally:
        await http.close()

    events = keyset["events"]

    if dump_only:
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        ts = datetime.now(timezone.utc).strftime("%Y%m%d_%H%M%S")
        out_path = out / f"poll_{ts}.json"
        dump = {
            "fetched_at": datetime.now(timezone.utc).isoformat(),
            "source": "polymarket",
            "sport": sport,
            "keyset_url": keyset["url"],
            "events_prematch": events,
        }
        out_path.write_text(json.dumps(dump, indent=2, default=str, ensure_ascii=False),
                            encoding="utf-8")
        log.info("dump-only: wrote %s (%d events)", out_path, len(events))
        return (len(events), 0, 0)

    event_rows, market_rows = [], []
    for ev in events:
        er = _extract_event_row(ev)
        if er is None:
            continue
        event_rows.append(er)
        market_rows.extend(_extract_market_rows(ev))
    n_ev = await db.upsert_poly_events(event_rows)
    n_mk = await db.upsert_poly_markets(market_rows)

    mapped, unmapped = 0, 0
    for er in event_rows:
        status, _ = await try_resolve(er)
        if status == "mapped":
            mapped += 1
        else:
            unmapped += 1
    # Retry phase — resolve các event trong buffer unmapped
    n_retried, n_new = await _retry_unmapped()
    # Sync canonical tokens cho MỌI mapped event (self-healing — fix cho row cũ
    # có home/away_token_id đảo lộn do bug logic cũ). Idempotent.
    all_mapped = await db.fetch_all_mapped_events()
    n_synced = 0
    for ev_id, cm_id in all_mapped:
        n_synced += await _sync_canonical_tokens_for_event(ev_id, cm_id)
    log.info("cycle: events=%d markets=%d mapped=%d unmapped=%d | "
             "retry=%d newly_mapped=%d | token_sync=%d",
             n_ev, n_mk, mapped, unmapped, n_retried, n_new, n_synced)
    return (n_ev, mapped, unmapped)


async def _service_loop(sport: str, interval_seconds: float, limit: int,
                         window_hours: int):
    """Forever loop. Reconnect DB 1 lần ở đầu; connection pool tự re-establish
    nếu server drop. Exception trong 1 cycle KHÔNG kill loop — log và tiếp."""
    log.info("polymarket-poller starting: sport=%s interval=%.1fs window=%dh limit=%d",
             sport, interval_seconds, window_hours, limit)
    await db.connect()
    log.info("DB connected")
    try:
        iteration = 0
        while True:
            iteration += 1
            t0 = time.perf_counter()
            try:
                await _run_once(sport, limit, window_hours, dump_only=False, out_dir="")
            except Exception as e:
                log.exception("cycle #%d error: %s", iteration, e)
            dt = time.perf_counter() - t0
            sleep = max(0.0, interval_seconds - dt)
            log.debug("cycle #%d took %.2fs, sleeping %.1fs", iteration, dt, sleep)
            await asyncio.sleep(sleep)
    finally:
        await db.close()


async def main():
    ap = argparse.ArgumentParser(description="Polymarket poller — fetch CS2 events + resolve mapping")
    ap.add_argument("--sport", default="all", choices=list(SPORT_TAG_IDS),
                    help="Sport scope: 'all' = tất cả esports (default), hoặc narrow tag")
    ap.add_argument("--limit", type=int, default=None,
                    help="Số event tối đa (default: settings.poly_page_limit)")
    ap.add_argument("--window-hours", type=int, default=None,
                    help="Cửa sổ prematch (default: settings.poly_window_hours)")
    ap.add_argument("--once", action="store_true",
                    help="Chạy 1 cycle rồi thoát (default: forever loop)")
    ap.add_argument("--interval", type=float, default=None,
                    help="Loop interval giây (default: settings.poly_poll_interval_seconds)")
    ap.add_argument("--dump-only", action="store_true",
                    help="Chỉ dump JSON, không ghi DB (implies --once)")
    ap.add_argument("--out-dir", default="dumps/polymarket")
    args = ap.parse_args()

    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )

    limit = args.limit if args.limit is not None else settings.poly_page_limit
    window = args.window_hours if args.window_hours is not None else settings.poly_window_hours
    interval = args.interval if args.interval is not None else settings.poly_poll_interval_seconds

    if args.dump_only or args.once:
        # Single-shot path
        if args.dump_only:
            await _run_once(args.sport, limit, window, dump_only=True, out_dir=args.out_dir)
        else:
            await db.connect()
            try:
                await _run_once(args.sport, limit, window, dump_only=False, out_dir=args.out_dir)
            finally:
                await db.close()
        return

    # Service loop path — check flag
    if not settings.poly_poll_enabled:
        log.info("POLY_POLL_ENABLED=false — exiting immediately (set true để chạy loop)")
        return
    await _service_loop(args.sport, interval, limit, window)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
