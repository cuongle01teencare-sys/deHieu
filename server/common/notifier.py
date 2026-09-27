"""Notification dispatch (multi-channel).

Hiện tại hỗ trợ Discord webhook. Thêm platform khác (Telegram, Slack, ...)
bằng cách viết thêm 1 sender và append vào ``_SENDERS``.

Design:
- Fire-and-forget: caller ``asyncio.create_task(notify_arbs(...))`` — module
  tự nuốt exception, chỉ log. Không được để notification làm crash arb loop.
- Batch: Discord webhook cho phép tối đa 10 embed / message. Ta chunk theo
  đó, tránh 429 khi cycle detect ra > 10 arb cùng lúc.
- Reusable client: 1 ``httpx.AsyncClient`` module-global, đóng khi shutdown.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any, Optional

import httpx

from server.common.config import settings

log = logging.getLogger("arb.notify")

_DISCORD_EMBED_LIMIT = 10   # Discord: tối đa 10 embed / webhook message
_HTTP_TIMEOUT = 8.0

_client: Optional[httpx.AsyncClient] = None
_client_lock = asyncio.Lock()


async def _get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        async with _client_lock:
            if _client is None:
                _client = httpx.AsyncClient(
                    timeout=_HTTP_TIMEOUT,
                    http2=True,
                    headers={"User-Agent": "deHieu-arb-notifier/1.0"},
                )
    return _client


async def close() -> None:
    """Gọi khi service shutdown (finally block)."""
    global _client
    if _client is not None:
        try:
            await _client.aclose()
        finally:
            _client = None


# ────────────────── Formatting ──────────────────

def _fmt_direction(direction: str, home: Optional[str], away: Optional[str]) -> str:
    """`sptpub_home_poly_away` → 'sptpub: <home>  |  poly: <away>'."""
    if direction == "sptpub_home_poly_away":
        return f"sptpub → **{home or 'home'}**   ·   poly → **{away or 'away'}**"
    if direction == "sptpub_away_poly_home":
        return f"sptpub → **{away or 'away'}**   ·   poly → **{home or 'home'}**"
    return direction


def _edge_color(edge_pct: float) -> int:
    """Xanh nhạt < 1%, xanh > 1%, vàng > 3%, đỏ (hot) > 5%."""
    if edge_pct >= 5.0:
        return 0xE74C3C   # red — hot
    if edge_pct >= 3.0:
        return 0xF1C40F   # yellow
    if edge_pct >= 1.0:
        return 0x2ECC71   # green
    return 0x3498DB       # blue — mild


def _build_discord_embed(opp: dict, home: Optional[str], away: Optional[str]) -> dict:
    edge = float(opp["edge_percent"])
    sum_inv = float(opp["sum_inverse"])
    match_line = f"{home} vs {away}" if home and away else opp["canonical_match_id"]
    return {
        "title": f"Arb {edge:.2f}%  ·  {match_line}",
        "description": _fmt_direction(opp["direction"], home, away),
        "color": _edge_color(edge),
        "fields": [
            {"name": "sptpub odds",
             "value": f"`{float(opp['sptpub_odds']):.3f}` ({opp['sptpub_side']})",
             "inline": True},
            {"name": "poly odds",
             "value": f"`{float(opp['poly_odds']):.3f}` ({opp['poly_side']})",
             "inline": True},
            {"name": "sum⁻¹",
             "value": f"`{sum_inv:.4f}`",
             "inline": True},
        ],
        "footer": {"text": f"match_id={opp['canonical_match_id']}"},
    }


# ────────────────── Senders ──────────────────

async def _send_discord(embeds: list[dict]) -> None:
    url = settings.discord_webhook_url
    if not url:
        return
    client = await _get_client()
    for i in range(0, len(embeds), _DISCORD_EMBED_LIMIT):
        chunk = embeds[i:i + _DISCORD_EMBED_LIMIT]
        payload = {"embeds": chunk, "username": "deHieu arb-detector"}
        try:
            r = await client.post(url, json=payload)
            if r.status_code == 429:
                # Discord ratelimit — respect Retry-After and try one more time
                retry_after = float(r.headers.get("Retry-After", "1"))
                await asyncio.sleep(min(retry_after, 5.0))
                r = await client.post(url, json=payload)
            if r.status_code >= 400:
                log.warning("discord webhook %d: %s", r.status_code, r.text[:200])
        except Exception as e:
            log.warning("discord webhook error: %s", e)


# ────────────────── Public entrypoint ──────────────────

async def notify_arbs(opportunities: list[dict], enrich_teams) -> None:
    """Gửi thông báo cho danh sách arb mới insert.

    ``enrich_teams`` là async callable ``(canonical_match_id) -> (home, away)|None``
    (thường là ``db.fetch_match_teams``). Truyền vào để notifier không phụ
    thuộc trực tiếp module ``db``, tránh circular import.

    Không bao giờ raise — mọi exception được nuốt + log.
    """
    try:
        if not opportunities:
            return
        min_edge = settings.notify_min_edge_pct
        filtered = [o for o in opportunities if float(o["edge_percent"]) >= min_edge]
        if not filtered:
            return

        # Enrich team names (concurrently)
        async def _one(opp):
            try:
                res = await enrich_teams(opp["canonical_match_id"])
                if res:
                    return opp, res[0], res[1]
            except Exception as e:
                log.debug("enrich_teams failed for %s: %s",
                          opp["canonical_match_id"], e)
            return opp, None, None

        enriched: list[tuple[dict, Any, Any]] = await asyncio.gather(
            *[_one(o) for o in filtered]
        )

        embeds = [_build_discord_embed(o, h, a) for (o, h, a) in enriched]

        # Fan-out per channel. Hiện chỉ Discord.
        await _send_discord(embeds)

    except Exception as e:
        log.exception("notify_arbs unexpected error: %s", e)
