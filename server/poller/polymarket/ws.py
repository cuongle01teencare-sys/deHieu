"""
Polymarket WebSocket ingestor (Phase 2A).

Connect wss://ws-subscriptions-frontend-clob.polymarket.com/ws/market, subscribe
theo clob_token_ids của market moneyline đã map với sptpub, nhận realtime
price_change ticks, ghi best_bid/best_ask vào polymarket.market_prices +
polymarket.price_history, và ghi decimal_odds=1/best_ask vào odds.odds_current.

Chỉ ingest market ĐÃ MAP — token chưa có canonical_match_id thì bỏ qua.

Chạy:
    python -m server.poller.polymarket.ws
    POLY_WS_ENABLED=false → exit ngay, không chạy loop.

Loop:
    fetch sub_map từ DB
    → open WS, subscribe token_ids
    → recv messages, parse best_bid/best_ask, buffer
    → flush buffer mỗi 500ms hoặc khi >= 100 ticks
    → mỗi 60s (poly_ws_refresh_seconds): re-fetch sub_map;
      nếu đổi → close WS, reconnect với sub mới
    → error: log + backoff + retry
"""
import asyncio
import json
import logging
import sys
import time
from datetime import datetime, timezone
from typing import Optional

import websockets

from server.common.config import settings
from server.common.db import db

log = logging.getLogger("poller.polymarket.ws")

_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36 Edg/153.0.0.0"
    ),
}


def _to_float(v) -> Optional[float]:
    if v is None:
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _parse_ms_ts(v) -> Optional[datetime]:
    if not v:
        return None
    try:
        return datetime.fromtimestamp(int(v) / 1000.0, tz=timezone.utc)
    except (TypeError, ValueError):
        return None


def _parse_snapshot_entry(entry: dict, sub_map: dict) -> Optional[dict]:
    """Book snapshot entry: {market, asset_id, bids: [{price,size}], asks: [...], timestamp, hash}.
    Compute best_bid = max(bid prices), best_ask = min(ask prices)."""
    token = entry.get("asset_id")
    info = sub_map.get(token)
    if not info:
        return None
    bids = entry.get("bids") or []
    asks = entry.get("asks") or []
    bid_prices = [_to_float(b.get("price")) for b in bids]
    ask_prices = [_to_float(a.get("price")) for a in asks]
    bid_prices = [p for p in bid_prices if p is not None]
    ask_prices = [p for p in ask_prices if p is not None]
    return {
        "canonical_match_id": info["canonical_match_id"],
        "condition_id": info["condition_id"],
        "token_id": token,
        "best_bid": max(bid_prices) if bid_prices else None,
        "best_ask": min(ask_prices) if ask_prices else None,
        "source_ts": _parse_ms_ts(entry.get("timestamp")),
    }


def _parse_message(data, sub_map: dict) -> list:
    """Trả list các tick dict — cover cả snapshot (list) và price_change (dict)."""
    ticks = []
    if isinstance(data, list):
        # Full book snapshot ngay sau subscribe: list of book entries
        for entry in data:
            if not isinstance(entry, dict):
                continue
            t = _parse_snapshot_entry(entry, sub_map)
            if t:
                ticks.append(t)
        return ticks

    if not isinstance(data, dict):
        return ticks

    et = data.get("event_type")
    if et == "price_change":
        ts_val = data.get("timestamp")
        source_ts = _parse_ms_ts(ts_val)
        for pc in data.get("price_changes") or []:
            token = pc.get("asset_id")
            info = sub_map.get(token)
            if not info:
                continue
            bid = _to_float(pc.get("best_bid"))
            ask = _to_float(pc.get("best_ask"))
            if bid is None and ask is None:
                continue
            ticks.append({
                "canonical_match_id": info["canonical_match_id"],
                "condition_id": info["condition_id"],
                "token_id": token,
                "best_bid": bid,
                "best_ask": ask,
                "source_ts": source_ts,
            })
    elif "bids" in data or "asks" in data:
        # Đôi khi snapshot là single dict, không phải list
        t = _parse_snapshot_entry(data, sub_map)
        if t:
            ticks.append(t)
    else:
        # Kiểu message khác (heartbeat, ack, ...) — bỏ qua
        log.debug("unknown message shape keys=%s", list(data.keys())[:8])
    return ticks


async def _run_session(sub_map: dict, refresh_seconds: int,
                        flush_seconds: float, flush_max: int) -> None:
    """Chạy 1 session WS đến khi tới hạn refresh hoặc gặp lỗi/close.
    Return khi cần reconnect (không raise trừ khi lỗi cứng)."""
    token_ids = list(sub_map.keys())
    log.info("WS connect: subscribing %d tokens across %d markets",
             len(token_ids), len({v["condition_id"] for v in sub_map.values()}))

    async with websockets.connect(
        settings.poly_ws_url,
        origin="https://polymarket.com",
        additional_headers=_HEADERS,
        ping_interval=20,
        ping_timeout=15,
        max_size=8 * 1024 * 1024,  # 8MB — snapshot có thể to
    ) as ws:
        subscribe_msg = json.dumps({"type": "markets", "assets_ids": token_ids})
        await ws.send(subscribe_msg)
        log.info("subscribe sent (%d bytes)", len(subscribe_msg))

        buffer: list = []
        last_flush = time.time()
        session_started = time.time()
        total_msgs = 0
        total_ticks = 0

        async def flush():
            nonlocal buffer, last_flush
            if not buffer:
                return
            batch = buffer
            buffer = []
            try:
                n, changed = await db.ingest_poly_prices(batch)
                log.info("flushed %d ticks (%d changed → history)", n, changed)
            except Exception as e:
                log.exception("flush failed: %s", e)
            last_flush = time.time()

        try:
            while True:
                # Refresh check
                if time.time() - session_started >= refresh_seconds:
                    await flush()
                    log.info("session %ds elapsed, closing to refresh sub map "
                             "(msgs=%d ticks=%d)",
                             refresh_seconds, total_msgs, total_ticks)
                    return

                # Recv với timeout ngắn để không block flush cadence
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=flush_seconds)
                except asyncio.TimeoutError:
                    if buffer:
                        await flush()
                    continue

                total_msgs += 1
                try:
                    data = json.loads(msg) if isinstance(msg, str) else msg
                except json.JSONDecodeError:
                    log.debug("non-JSON msg skipped: %s", str(msg)[:100])
                    continue

                new_ticks = _parse_message(data, sub_map)
                buffer.extend(new_ticks)
                total_ticks += len(new_ticks)

                if len(buffer) >= flush_max:
                    await flush()
                elif time.time() - last_flush >= flush_seconds:
                    await flush()
        finally:
            # Flush cuối trước khi close
            await flush()


async def main():
    logging.basicConfig(
        level=settings.log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    if not settings.poly_ws_enabled:
        log.info("POLY_WS_ENABLED=false — exit ngay, set true để chạy")
        return

    log.info("polymarket-ws-ingestor starting: url=%s refresh=%ds flush=%.2fs/%dmax",
             settings.poly_ws_url,
             settings.poly_ws_refresh_seconds,
             settings.poly_ws_flush_seconds,
             settings.poly_ws_flush_max)

    await db.connect()
    log.info("DB connected")

    try:
        while True:
            try:
                sub_map = await db.fetch_poly_ws_subscription_map()
                if not sub_map:
                    log.info("no mapped moneyline markets to subscribe, sleep 60s")
                    await asyncio.sleep(60)
                    continue
                await _run_session(
                    sub_map,
                    refresh_seconds=settings.poly_ws_refresh_seconds,
                    flush_seconds=settings.poly_ws_flush_seconds,
                    flush_max=settings.poly_ws_flush_max,
                )
            except (websockets.ConnectionClosed, asyncio.CancelledError):
                log.warning("WS closed, reconnecting after backoff")
                await asyncio.sleep(settings.poly_ws_reconnect_backoff_seconds)
            except Exception as e:
                log.exception("session error: %s", e)
                await asyncio.sleep(settings.poly_ws_reconnect_backoff_seconds)
    finally:
        await db.close()
        log.info("polymarket-ws-ingestor stopped")


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        sys.exit(130)
