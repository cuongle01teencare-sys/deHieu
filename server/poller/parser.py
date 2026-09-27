"""
Bóc `/api/v4/live|prematch/...` payload thành các entity chuẩn hoá:

  Dimension:
    - iter_sports       → sports{}
    - iter_categories   → categories{}
    - iter_tournaments  → tournaments{}
    - iter_competitors  → dedup competitors từ events[].desc.competitors[]

  Fact / relational:
    - iter_matches            → matches (slim: id, sport_id, tournament_id, ...)
    - iter_match_competitors  → match_competitors (home/away m:n)
    - iter_score_events       → score_events (overall home/away)
    - iter_period_scores_for  → period_scores per match snapshot (helper)
    - iter_removed_ids        → match_id nào bị None (rời live view)
"""
import json
from typing import Iterator


def _safe_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def _events(payload: dict) -> dict:
    """Support cả 2 schema: mới (events dict) và cũ (match keys top-level).
    Filter ra event có value None (đã bị remove trong delta)."""
    events = payload.get("events")
    if isinstance(events, dict):
        return {k: v for k, v in events.items() if isinstance(v, dict)}
    return {k: v for k, v in payload.items()
            if k.isdigit() and len(k) >= 15 and isinstance(v, dict)}


# ─────────────── DIMENSION ITERATORS ───────────────

def iter_sports(payload: dict) -> Iterator[dict]:
    for sid, s in (payload.get("sports") or {}).items():
        if not isinstance(s, dict):
            continue
        yield {
            "id": str(sid),
            "name": (s.get("name") or "").strip(),
            "slug": s.get("slug"),
            "inside_out": bool(s.get("inside_out", False)),
            "priority": _safe_int(s.get("priority")) or 0,
        }


def iter_categories(payload: dict) -> Iterator[dict]:
    for cid, c in (payload.get("categories") or {}).items():
        if not isinstance(c, dict):
            continue
        yield {
            "id": str(cid),
            "sport_id": c.get("sport_id"),
            "name": (c.get("name") or "").strip(),
            "slug": c.get("slug"),
            "country_code": c.get("country_code") or None,
            "priority": _safe_int(c.get("priority")) or 0,
        }


def iter_tournaments(payload: dict) -> Iterator[dict]:
    for tid, t in (payload.get("tournaments") or {}).items():
        if not isinstance(t, dict):
            continue
        yield {
            "id": str(tid),
            "category_id": t.get("category_id"),
            "name": (t.get("name") or "").strip(),
            "slug": t.get("slug"),
            "priority": _safe_int(t.get("priority")) or 0,
            "priority_live": _safe_int(t.get("priority_live")) or 0,
            "promo": bool(t.get("promo", False)),
            "tier": t.get("tier"),
        }


def iter_competitors(payload: dict) -> Iterator[dict]:
    """Dedup competitors across events (1 competitor có thể xuất hiện nhiều match)."""
    seen: set = set()
    for _mid, blob in _events(payload).items():
        desc = blob.get("desc") or {}
        for comp in desc.get("competitors") or []:
            if not isinstance(comp, dict):
                continue
            cid = comp.get("id")
            if not cid or cid in seen:
                continue
            seen.add(cid)
            yield {
                "id": str(cid),
                "sport_id": comp.get("sport_id") or desc.get("sport"),
                "name": (comp.get("name") or "").strip(),
                "country_code": comp.get("country_code") or None,
                "abbreviation": comp.get("abbreviation"),
            }


# ─────────────── MATCH ITERATORS ───────────────

def iter_matches(payload: dict) -> Iterator[dict]:
    """Yield metadata slim để upsert vào matches (không còn home/away name)."""
    for mid, blob in _events(payload).items():
        desc = blob.get("desc") or {}
        if not desc:
            continue
        yield {
            "id": mid,
            "sport_id": desc.get("sport"),
            "tournament_id": desc.get("tournament"),
            "scheduled": desc.get("scheduled"),
            "virtual": bool(desc.get("virtual", False)),
            "slug": desc.get("slug"),
        }


def iter_match_competitors(payload: dict) -> Iterator[dict]:
    """Yield {match_id, competitor_id, side} — competitors[0]=home, [1]=away."""
    for mid, blob in _events(payload).items():
        desc = blob.get("desc") or {}
        competitors = desc.get("competitors") or []
        for i, comp in enumerate(competitors[:2]):
            if not isinstance(comp, dict):
                continue
            cid = comp.get("id")
            if not cid:
                continue
            yield {
                "match_id": mid,
                "competitor_id": str(cid),
                "side": "home" if i == 0 else "away",
            }


def iter_score_events(payload: dict) -> Iterator[dict]:
    """Overall home/away score cho mỗi match có `score`."""
    for mid, blob in _events(payload).items():
        score = blob.get("score")
        if not score:
            continue
        state = blob.get("state") or {}
        periods = score.get("period_scores") or []
        latest_period = periods[-1].get("number") if periods else None
        yield {
            "match_id": mid,
            "home_score": _safe_int(score.get("home_score")),
            "away_score": _safe_int(score.get("away_score")),
            "period": latest_period,
            "match_status": _safe_int(state.get("match_status")),
            "raw_json": json.dumps({"score": score, "state": state},
                                   ensure_ascii=False),
        }


def iter_period_scores_for(blob: dict) -> list[dict]:
    """Với 1 event blob, trả list các period rows (chưa có ts — caller thêm)."""
    score = blob.get("score") or {}
    out = []
    for p in (score.get("period_scores") or []):
        if not isinstance(p, dict):
            continue
        num = _safe_int(p.get("number"))
        if num is None:
            continue
        out.append({
            "number": num,
            "match_status_code": _safe_int(p.get("match_status_code")),
            "home_score": _safe_int(p.get("home_score")),
            "away_score": _safe_int(p.get("away_score")),
        })
    return out


def iter_removed_ids(payload: dict) -> Iterator[str]:
    events = payload.get("events")
    if not isinstance(events, dict):
        return
    for mid, blob in events.items():
        if blob is None:
            yield mid


# ─────────────── ODDS / MARKETS ───────────────
# Format của `markets` trong mỗi event blob:
#   markets = {
#     "<market_id>": {
#         "<specifier_key>": {                # "" khi market không có specifier
#             "<outcome_id>": {"k": "1.88"}
#         }
#     }
#   }
# `k` = decimal odds (string). Specifier key ví dụ "mapnr=1|hcp=-2.5".
#
# Player-props markets (60040/60041/60043) có `player=od:player:...` trong
# specifier_key. Loop dùng PLAYER_PROP_MARKET_IDS để biết trận nào cần
# fetch per-event descriptions endpoint để lookup tên player.

PLAYER_PROP_MARKET_IDS = {"60040", "60041", "60043"}


def _decimal_or_none(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def iter_market_odds(payload: dict) -> Iterator[dict]:
    """Yield mỗi outcome trong payload dưới dạng row phẳng, sẵn cho DB.
    Row = {match_id, market_id, specifier_key, outcome_id, decimal_odds}."""
    for mid, blob in _events(payload).items():
        markets = blob.get("markets") or {}
        if not isinstance(markets, dict):
            continue
        for market_id, buckets in markets.items():
            if not isinstance(buckets, dict):
                continue
            for spec_key, outcomes in buckets.items():
                if not isinstance(outcomes, dict):
                    continue
                for outcome_id, obj in outcomes.items():
                    if not isinstance(obj, dict):
                        continue
                    odds = _decimal_or_none(obj.get("k"))
                    if odds is None:
                        continue
                    yield {
                        "match_id": str(mid),
                        "market_id": str(market_id),
                        "specifier_key": spec_key or "",
                        "outcome_id": str(outcome_id),
                        "decimal_odds": odds,
                    }


def iter_matches_with_player_props(payload: dict) -> Iterator[str]:
    """Yield match_id có ít nhất 1 player-props market → caller fetch
    per-event descriptions cho những trận này để có tên player."""
    for mid, blob in _events(payload).items():
        markets = blob.get("markets") or {}
        if isinstance(markets, dict) and (set(markets.keys()) & PLAYER_PROP_MARKET_IDS):
            yield str(mid)


# ─────────────── DESCRIPTOR PARSERS ───────────────
# Được gọi bởi descriptors_loop / on-demand fetch, không phải từ payload live.

def parse_market_descriptors(payload: dict) -> Iterator[dict]:
    """/api/v3/descriptions/brand/{brand}/markets/en → dict {market_id: {...}}.
    Yield row cho db.upsert_market_descriptors."""
    if not isinstance(payload, dict):
        return
    for market_id, m in payload.items():
        if not isinstance(m, dict):
            continue
        yield {
            "id": str(market_id),
            "name": m.get("name"),
            "market_type": m.get("market_type"),
            "specifiers": m.get("specifiers") or [],
            "variants": m.get("variants") or {},
        }


def parse_event_descriptions(payload: dict) -> tuple[list[dict], list[dict]]:
    """/api/v3/descriptions/brand/{brand}/event/{event_id}/en →
       {players: [...], markets: {market_id: {name, variants{spec_key: [{name, outcomes}]}}}}

    Trả (players_rows, overrides_rows):
      players_rows   = [{id, name, competitor_id}, ...]
      overrides_rows = [{market_id, specifier_key, market_name, outcomes[]}, ...]"""
    players = []
    for p in (payload.get("players") or []):
        if not isinstance(p, dict) or not p.get("id"):
            continue
        players.append({
            "id": p["id"],
            "name": (p.get("name") or "").strip() or None,
            "competitor_id": p.get("competitor_id"),
        })

    overrides = []
    for market_id, m in (payload.get("markets") or {}).items():
        if not isinstance(m, dict):
            continue
        for spec_key, variant_list in (m.get("variants") or {}).items():
            # variant_list là list of {name, outcomes[]}. Thường có 1 phần tử.
            if not isinstance(variant_list, list) or not variant_list:
                continue
            v = variant_list[0]
            overrides.append({
                "market_id": str(market_id),
                "specifier_key": spec_key or "",
                "market_name": v.get("name") or m.get("name"),
                "outcomes": v.get("outcomes") or [],
            })
    return players, overrides
