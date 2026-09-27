"""
Arb detector service.

Poll odds.odds_current mỗi ARB_POLL_INTERVAL_SECONDS. Cho mỗi canonical match
có đủ 4 quote tươi (sptpub_home, sptpub_away, poly_home, poly_away), compute
2 direction và ghi/close odds.arb_opportunities theo behavior:

- No open + edge > 0            → INSERT
- Open + edge > 0 + improve ≥ N → close old (reason=improved) + INSERT new
- Open + edge > 0 + improve < N → touch (last_seen + peak)
- Open + edge <= 0              → close (edge_negative)
- Open + match không fresh      → close (stale_odds)

Chạy: python -m server.arb
"""
import asyncio
import logging
import sys

from server.common.config import settings
from server.common.db import db
from server.common import notifier

log = logging.getLogger("arb.detector")

DIRECTIONS = [
    ("sptpub_home_poly_away", "home", "away"),
    ("sptpub_away_poly_home", "away", "home"),
]


def _compute_arb(sptpub_odds: float, poly_odds: float) -> tuple[float, float]:
    """Trả (sum_inverse, edge_percent). edge_percent = 0 nếu không phải arb.
    Return (inf, 0) nếu odds <= 0 (bookmaker suspend market, poly no ask, ...)."""
    if sptpub_odds <= 0 or poly_odds <= 0:
        return (float("inf"), 0.0)
    sum_inv = 1.0 / sptpub_odds + 1.0 / poly_odds
    edge_pct = ((1.0 / sum_inv) - 1.0) * 100.0 if sum_inv < 1.0 else 0.0
    return sum_inv, edge_pct


async def _run_cycle(min_improvement_pct: float, freshness_seconds: int) -> dict:
    rows = await db.fetch_fresh_canonical_pairs(freshness_seconds)
    match_quotes: dict = {}
    for r in rows:
        match_quotes.setdefault(r["match_id"], {})[
            (r["platform"], r["side"])
        ] = (float(r["decimal_odds"]), r["updated_at"])

    required = [("sptpub", "home"), ("sptpub", "away"),
                ("polymarket", "home"), ("polymarket", "away")]
    complete = {
        mid: q for mid, q in match_quotes.items()
        if all(k in q for k in required)
    }

    all_opens = await db.fetch_all_open_arbs()
    open_map = {(r["canonical_match_id"], r["direction"]): r for r in all_opens}

    to_insert: list = []
    to_touch: list = []
    to_close: list = []
    complete_keys = set(complete.keys())

    for mid, quotes in complete.items():
        for direction, sside, pside in DIRECTIONS:
            sptpub_odds, sptpub_ts = quotes[("sptpub", sside)]
            poly_odds, poly_ts = quotes[("polymarket", pside)]
            sum_inv, edge_pct = _compute_arb(sptpub_odds, poly_odds)
            existing = open_map.get((mid, direction))

            if edge_pct <= 0:
                if existing:
                    to_close.append((existing["id"], "edge_negative"))
                continue

            if existing is None:
                to_insert.append({
                    "canonical_match_id": mid, "direction": direction,
                    "sptpub_side": sside, "poly_side": pside,
                    "sptpub_odds": sptpub_odds, "poly_odds": poly_odds,
                    "sum_inverse": sum_inv, "edge_percent": edge_pct,
                    "sptpub_updated_at": sptpub_ts, "poly_updated_at": poly_ts,
                })
            else:
                improvement = edge_pct - float(existing["edge_percent"])
                if improvement >= min_improvement_pct:
                    to_close.append((existing["id"], "improved"))
                    to_insert.append({
                        "canonical_match_id": mid, "direction": direction,
                        "sptpub_side": sside, "poly_side": pside,
                        "sptpub_odds": sptpub_odds, "poly_odds": poly_odds,
                        "sum_inverse": sum_inv, "edge_percent": edge_pct,
                        "sptpub_updated_at": sptpub_ts, "poly_updated_at": poly_ts,
                    })
                else:
                    to_touch.append((existing["id"], edge_pct, sptpub_ts, poly_ts))

    # Close open arbs whose match no longer in fresh set
    for (mid, direction), row in open_map.items():
        if mid not in complete_keys:
            to_close.append((row["id"], "stale_odds"))

    n_close = await db.close_arbs(to_close)
    n_touch = await db.touch_arbs(to_touch)
    n_insert = await db.insert_arbs(to_insert)

    # Fire-and-forget notify cho các arb VỪA insert. Chỉ gửi nếu có webhook
    # cấu hình (notifier tự check settings.discord_webhook_url).
    if to_insert and settings.discord_webhook_url:
        asyncio.create_task(
            notifier.notify_arbs(to_insert, db.fetch_match_teams)
        )

    return {
        "matches_scanned": len(complete),
        "opens_before": len(all_opens),
        "inserted": n_insert,
        "closed": n_close,
        "touched": n_touch,
    }


async def main():
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    if not settings.arb_enabled:
        log.info("ARB_ENABLED=false — exit")
        return

    log.info("arb-detector: poll=%.1fs freshness=%ds min_improve=%.2f%%",
             settings.arb_poll_interval_seconds,
             settings.arb_freshness_seconds,
             settings.arb_min_edge_improvement_pct)

    await db.connect()
    log.info("DB connected")

    iteration = 0
    try:
        while True:
            iteration += 1
            t0 = asyncio.get_event_loop().time()
            try:
                stats = await _run_cycle(
                    settings.arb_min_edge_improvement_pct,
                    settings.arb_freshness_seconds,
                )
                dt = asyncio.get_event_loop().time() - t0
                if stats["inserted"] or stats["closed"] or (iteration % 30 == 0):
                    log.info("cycle #%d: matches=%d opens=%d "
                             "insert=%d close=%d touch=%d dt=%.2fs",
                             iteration, stats["matches_scanned"],
                             stats["opens_before"], stats["inserted"],
                             stats["closed"], stats["touched"], dt)
            except Exception as e:
                log.exception("cycle #%d error: %s", iteration, e)
            elapsed = asyncio.get_event_loop().time() - t0
            sleep = max(0.0, settings.arb_poll_interval_seconds - elapsed)
            await asyncio.sleep(sleep)
    finally:
        await notifier.close()
        await db.close()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
