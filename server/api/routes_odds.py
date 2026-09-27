"""REST route /api/platforms/{platform}/matches/{slug}/odds — trả markets +
odds hiện tại của 1 trận, đã render đầy đủ tên đội / tên player / label
outcome. CHỈ ĐỌC — không trigger poll (poll chạy nền độc lập).

Slug format: `<slug>-<match_id>`, ví dụ:
    100-thieves-astralis-2715304220298457124
Cắt regex `-(\\d{15,})$` để tách match_id, không có fallback (như user chọn).
"""
import json
import re
import logging
from typing import Any, Optional

from fastapi import APIRouter, HTTPException

from server.common.db import db

log = logging.getLogger("api.odds")
router = APIRouter(prefix="/api/platforms", tags=["odds"])


# ─────────────── Template rendering ───────────────
# Bám sát grammar của sptpub market descriptor:
#   {$competitorN}  → tên đội
#   {!x}            → giá trị specifier x (ordinal khi thích hợp)
#   {+x}            → giá trị x với dấu +, dùng cho handicap dương
#   {-x}            → giá trị x đảo dấu
#   {x}             → giá trị x nguyên
# Ngoài ra outcome name có thể chứa các placeholder tương tự.

_TOKEN_RE = re.compile(r"\{([^}]+)\}")


def _as_json(v: Any) -> Any:
    """Defensive: JSONB codec chưa register → asyncpg trả str thô. Parse tay
    nếu cần. Khi codec đã register (bản >= JSONB fix), pass-through nguyên."""
    if isinstance(v, str):
        try:
            return json.loads(v)
        except (json.JSONDecodeError, ValueError):
            return None
    return v


def _fmt_num(v: str) -> str:
    try:
        f = float(v)
        return f"{int(f)}" if f.is_integer() else f"{f:g}"
    except (TypeError, ValueError):
        return str(v)


def _render(template: Optional[str], specs: dict, c1: str, c2: str) -> str:
    if not template:
        return ""

    def sub(m: re.Match) -> str:
        tok = m.group(1)
        if tok == "$competitor1":
            return c1
        if tok == "$competitor2":
            return c2
        if tok.startswith("+"):
            v = specs.get(tok[1:], "")
            try:
                return f"{float(v):+g}"
            except (TypeError, ValueError):
                return v
        if tok.startswith("-"):
            v = specs.get(tok[1:], "")
            try:
                return f"{-float(v):+g}"
            except (TypeError, ValueError):
                return v
        if tok.startswith("!"):
            return _fmt_num(specs.get(tok[1:], ""))
        return _fmt_num(specs.get(tok, ""))

    return _TOKEN_RE.sub(sub, template)


def _parse_specifier_key(spec_key: str) -> dict:
    """'mapnr=1|hcp=-2.5' → {'mapnr':'1','hcp':'-2.5'}. '' → {}."""
    if not spec_key:
        return {}
    return dict(part.split("=", 1) for part in spec_key.split("|") if "=" in part)


def _outcome_name_from_variants(variants: dict, spec_key: str,
                                 outcome_id: str) -> Optional[str]:
    """Tra tên outcome trong variants{} của market descriptor.
    variants có thể chia theo spec_key ('mapnr=1') hoặc dùng '' (không specifier).
    Fallback: quét tất cả variants tìm outcome id trùng."""
    if not isinstance(variants, dict):
        return None
    # Sptpub variants dùng key rỗng cho không có specifier — thử trực tiếp
    for key in (spec_key, "", spec_key.split("|", 1)[0] if spec_key else ""):
        v = variants.get(key)
        if not v:
            continue
        # v có thể là list[{outcomes:[]}] hoặc dict
        if isinstance(v, list) and v:
            v = v[0]
        for out in (v.get("outcomes") or []):
            if str(out.get("id")) == str(outcome_id):
                return out.get("name")
    # Full scan fallback
    for _spec, vv in variants.items():
        if isinstance(vv, list) and vv:
            vv = vv[0]
        if isinstance(vv, dict):
            for out in (vv.get("outcomes") or []):
                if str(out.get("id")) == str(outcome_id):
                    return out.get("name")
    return None


# ─────────────── Route ───────────────

@router.get("/{platform}/matches/{slug}/odds")
async def get_match_odds(platform: str, slug: str):
    """Trả markets + odds hiện tại. Response shape:

    {
      "platform": "csgoempire",
      "match_id": "2715306923066007564",
      "slug": "alliance-3dmax",
      "home": {"id": "...", "name": "Alliance"},
      "away": {"id": "...", "name": "3DMAX"},
      "status": {"code": 0, "label": "Not started"},
      "markets": [
        {
          "market_id": "328",
          "market_label": "Total maps",
          "market_type": "Total",
          "specifier": {"total": "2.5"},
          "outcomes": [
            {"outcome_id": "12", "label": "over 2.5", "odds": 1.88,
             "player_id": null, "competitor_id": null,
             "updated_at": "2026-09-26T..."}
          ]
        }
      ]
    }
    """
    # 1) Parse slug + lookup match
    mid = await db.fetch_match_id_by_slug(slug)
    if not mid:
        raise HTTPException(404, f"match not found for slug '{slug}' "
                                 "(expected format '<slug>-<match_id>')")

    # 2) Meta match (tên đội, status)
    match = await db.get_match(mid)
    if not match:
        raise HTTPException(404, f"match {mid} không có trong `matches`")

    c1 = match.get("home_name") or ""
    c2 = match.get("away_name") or ""
    status_code = match.get("match_status")
    status_label = await db.get_status_label(platform, status_code)
    phase = match.get("phase")

    # 3) Odds rows (đã JOIN descriptor + override sẵn ở SQL)
    rows = await db.get_odds_for_match(platform, mid)

    # 4) Group theo (market_id, specifier_key)
    groups: dict[tuple, dict] = {}
    for r in rows:
        key = (r["market_id"], r["specifier_key"])
        specs = _parse_specifier_key(r["specifier_key"])
        # Defensive: đảm bảo variants + override_outcomes là dict/list, kể
        # cả khi asyncpg trả JSONB dạng str thô (codec chưa register).
        market_variants  = _as_json(r.get("market_variants")) or {}
        override_outs    = _as_json(r.get("override_outcomes")) or []

        if key not in groups:
            # Ưu tiên override name (đã render tên player/team sẵn),
            # fallback render template.
            market_label = r.get("override_market_name") or _render(
                r.get("market_template"), specs, c1, c2,
            )
            groups[key] = {
                "market_id": r["market_id"],
                "market_label": market_label,
                "market_type": r.get("market_type"),
                "specifier": specs,
                "outcomes": [],
            }

        # Outcome label: ưu tiên override outcomes (có tên player/team đầy đủ),
        # fallback render từ variants của descriptor.
        outcome_label = None
        for o in override_outs:
            if isinstance(o, dict) and str(o.get("id")) == r["outcome_id"]:
                outcome_label = o.get("name")
                break
        if not outcome_label:
            outcome_name_tmpl = _outcome_name_from_variants(
                market_variants,
                r["specifier_key"],
                r["outcome_id"],
            )
            outcome_label = _render(outcome_name_tmpl, specs, c1, c2) if outcome_name_tmpl else None

        # Lấy player_id / competitor_id từ override nếu có (cho player-props)
        player_id = None
        competitor_id = None
        for o in override_outs:
            if isinstance(o, dict) and str(o.get("id")) == r["outcome_id"]:
                player_id = o.get("player_id")
                competitor_id = o.get("competitor_id")
                break

        groups[key]["outcomes"].append({
            "outcome_id": r["outcome_id"],
            "label": outcome_label or f"outcome {r['outcome_id']}",
            "odds": float(r["decimal_odds"]) if r["decimal_odds"] is not None else None,
            "player_id": player_id,
            "competitor_id": competitor_id,
            "updated_at": r["updated_at"].isoformat() if r["updated_at"] else None,
        })

    # 5) Output ổn định: sort theo market_id (numeric) rồi specifier_key
    markets_out = sorted(
        groups.values(),
        key=lambda g: (int(g["market_id"]) if g["market_id"].isdigit() else 10**9,
                       g["market_id"], str(g["specifier"])),
    )

    return {
        "platform": platform,
        "match_id": mid,
        "slug": match.get("slug"),
        "phase": phase,     # 'prematch' | 'live' | 'ended' | None
        "home": {"id": match.get("home_id"), "name": c1},
        "away": {"id": match.get("away_id"), "name": c2},
        "status": {"code": status_code, "label": status_label},
        "markets_count": len(markets_out),
        "outcomes_count": sum(len(g["outcomes"]) for g in markets_out),
        "markets": markets_out,
    }
