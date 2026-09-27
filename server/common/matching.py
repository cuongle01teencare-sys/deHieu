"""
Match resolver — ghép event của tenant (poly, ...) với canonical match trong
`public.matches` (SoT từ sptpub).

Chiến lược 2 tầng (tầng 3 fuzzy để sau, chưa cần rapidfuzz):

  Tầng 1 — exact normalized:
    Normalize tên team → cặp {home, away} không thứ tự + start_time snap 15 phút.
    Tenant name và canonical name khớp exact (sau normalize) → confidence 1.0.

  Tầng 2 — alias resolved:
    Nếu tầng 1 miss, resolve tên tenant qua bảng `public.team_aliases` để ra
    canonical_norm, rồi so lại. Ví dụ 'navi' → 'natusvincere'. Confidence 0.95.

Đầu ra:
  find_canonical_match(...) -> (match_id, confidence, method, details) | None

Không có tầng fuzzy string match nào ở đây — nếu không hit tầng 1/2, gọi ghi
vào `polymarket.unmapped_events` và bỏ qua. Thêm alias qua CLI để phủ thêm.
"""
import re
import unicodedata
from datetime import datetime
from typing import Optional, Tuple


# Suffix noise strip trước khi alphanumeric-only. Order matters: dài trước.
_TEAM_NAME_SUFFIX_NOISE = [
    " esports", " gaming", " team", " academy",
    ".gg", " gg", " clan", " club", " sports",
]

# Prefix noise — chuẩn hoá case "Team Liquid" ↔ "Liquid" (poly hay dùng
# dạng ngắn, csgoempire hay dùng dạng có prefix org). "Team X" là quy ước
# esports phổ biến — X là tên team, "Team" chỉ là prefix org name.
_TEAM_NAME_PREFIX_NOISE = [
    "team ",
    "the ",
]


def normalize_team_name(name: str) -> str:
    """
    'NAVI'                    -> 'navi'
    'Natus Vincere'           -> 'natusvincere'
    'G2 Esports'              -> 'g2'          (strip ' esports')
    'HEROIC Academy'          -> 'heroic'      (strip ' academy')
    'against All authority'   -> 'againstallauthority'
    'FaZe Clan'               -> 'faze'        (strip ' clan')
    'Cloud9'                  -> 'cloud9'
    '  Vitality '             -> 'vitality'
    """
    if not name:
        return ""
    # NFKD → chuyển diacritic thành base + combining, strip non-ASCII
    n = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    n = n.strip().lower()
    # Strip suffix noise (chỉ khi ở cuối)
    changed = True
    while changed:
        changed = False
        for suf in _TEAM_NAME_SUFFIX_NOISE:
            if n.endswith(suf):
                n = n[: -len(suf)].strip()
                changed = True
    # Strip prefix noise (chỉ khi ở đầu)
    changed = True
    while changed:
        changed = False
        for pre in _TEAM_NAME_PREFIX_NOISE:
            if n.startswith(pre):
                n = n[len(pre):].strip()
                changed = True
    # Bỏ mọi ký tự non-alphanumeric
    n = re.sub(r"[^a-z0-9]", "", n)
    return n


def snap_time(dt: datetime, bucket_seconds: int = 900) -> int:
    """Snap datetime về mốc bucket (mặc định 15 phút). Trả unix seconds int."""
    ts = int(dt.timestamp())
    return (ts // bucket_seconds) * bucket_seconds


async def find_canonical_match(
    db,
    sport: str,
    home_name: str,
    away_name: str,
    start_time: datetime,
    tolerance_seconds: int = 900,
) -> Optional[Tuple[str, float, str, dict]]:
    """
    Ghép 1 event của tenant với canonical match trong public.matches.

    Args:
        db: instance Database (đã connect)
        sport: 'cs2' (giá trị này dùng LIKE % match tên sport trong public.sports —
               VD 'cs2' match 'Counter-Strike', 'CS2', 'counter-strike 2', ...)
        home_name / away_name: tên team raw từ tenant
        start_time: datetime UTC của trận theo tenant
        tolerance_seconds: cửa sổ tìm sptpub match quanh start_time (mặc định ±15 phút)

    Returns:
        (canonical_match_id, confidence, method, details) nếu ghép được
        None nếu không có candidate hoặc >1 candidate mà không phân biệt được

    Method values:
        'exact_norm' — cặp tên trùng exact sau normalize
        'alias'      — cặp tên trùng sau resolve qua team_aliases

    Details JSONB chứa các normalized names + time_diff_seconds cho audit.
    """
    tenant_home_norm = normalize_team_name(home_name)
    tenant_away_norm = normalize_team_name(away_name)
    if not tenant_home_norm or not tenant_away_norm:
        return None

    # Sport LIKE — user truyền 'cs2' → SQL match tên sport có chứa 'cs' hoặc
    # 'counter'. Đơn giản nhất: build LIKE pattern theo sport passed.
    sport_like = _sport_like_pattern(sport)

    candidates = await db.find_candidate_matches(sport_like, start_time, tolerance_seconds)
    if not candidates:
        return None

    tenant_pair = frozenset({tenant_home_norm, tenant_away_norm})

    # Tầng 1: exact normalized set match
    tier1_hits = []
    for c in candidates:
        sp_home_norm = normalize_team_name(c["home_name"] or "")
        sp_away_norm = normalize_team_name(c["away_name"] or "")
        if frozenset({sp_home_norm, sp_away_norm}) == tenant_pair:
            tier1_hits.append((c, sp_home_norm, sp_away_norm))

    if len(tier1_hits) == 1:
        c, sph, spa = tier1_hits[0]
        return (
            c["id"], 1.0, "exact_norm",
            {
                "tenant_home_norm": tenant_home_norm,
                "tenant_away_norm": tenant_away_norm,
                "sptpub_home_norm": sph,
                "sptpub_away_norm": spa,
                "time_diff_seconds": int((c["scheduled_at"] - start_time).total_seconds()),
                "candidates_count": len(candidates),
            },
        )
    if len(tier1_hits) > 1:
        # Không nên xảy ra ở CS2 (2 team + time bucket là unique) nhưng vẫn defensive
        return None

    # Tầng 2: alias resolved
    tenant_home_canon = await db.resolve_team_alias(sport, tenant_home_norm) or tenant_home_norm
    tenant_away_canon = await db.resolve_team_alias(sport, tenant_away_norm) or tenant_away_norm
    if (tenant_home_canon, tenant_away_canon) == (tenant_home_norm, tenant_away_norm):
        # Không alias nào resolve khác — tức tầng 2 không đóng góp gì mới
        return None
    tenant_pair_canon = frozenset({tenant_home_canon, tenant_away_canon})

    tier2_hits = []
    for c in candidates:
        sp_home_norm = normalize_team_name(c["home_name"] or "")
        sp_away_norm = normalize_team_name(c["away_name"] or "")
        sp_home_canon = await db.resolve_team_alias(sport, sp_home_norm) or sp_home_norm
        sp_away_canon = await db.resolve_team_alias(sport, sp_away_norm) or sp_away_norm
        if frozenset({sp_home_canon, sp_away_canon}) == tenant_pair_canon:
            tier2_hits.append((c, sp_home_canon, sp_away_canon))

    if len(tier2_hits) == 1:
        c, sph, spa = tier2_hits[0]
        return (
            c["id"], 0.95, "alias",
            {
                "tenant_home_norm": tenant_home_norm,
                "tenant_away_norm": tenant_away_norm,
                "tenant_home_canon": tenant_home_canon,
                "tenant_away_canon": tenant_away_canon,
                "sptpub_home_canon": sph,
                "sptpub_away_canon": spa,
                "time_diff_seconds": int((c["scheduled_at"] - start_time).total_seconds()),
                "candidates_count": len(candidates),
            },
        )

    return None


def _sport_like_pattern(sport: str) -> str:
    """
    Từ 'cs2' → '%counter%' (chấp nhận 'Counter-Strike', 'CS2', ...).
    Từ 'dota2' → '%dota%'. Etc.
    Simple mapping table — mở rộng khi thêm sport mới.
    """
    m = {
        "cs2":   "%counter%",
        "csgo":  "%counter%",
        "dota2": "%dota%",
        "lol":   "%league%",
        "valorant": "%valorant%",
    }
    return m.get(sport.lower(), f"%{sport.lower()}%")


def sample_alias_seed_cs2() -> list[tuple[str, str, str, str]]:
    """
    Bootstrap seed cho CS2 top-tier teams. Format tuple:
        (sport, alias, canonical_name, canonical_norm)

    Populate qua migration một lần, sau đó user thêm/sửa qua CLI. Không phải
    bảng tra cứu đầy đủ — chỉ những alias có real ambiguity giữa 2 nền tảng.
    """
    return [
        # (sport, alias, canonical_name_display, canonical_norm)
        ("cs2", "navi",           "Natus Vincere",  "natusvincere"),
        ("cs2", "nv",             "Natus Vincere",  "natusvincere"),
        ("cs2", "mouz",           "MOUZ",           "mouz"),
        ("cs2", "mousesports",    "MOUZ",           "mouz"),
        ("cs2", "faze",           "FaZe Clan",      "faze"),
        ("cs2", "fazeclan",       "FaZe Clan",      "faze"),
        ("cs2", "vp",             "Virtus.pro",     "virtuspro"),
        ("cs2", "virtuspro",      "Virtus.pro",     "virtuspro"),
        ("cs2", "big",            "BIG",            "big"),
        ("cs2", "hltv",           "HLTV",           "hltv"),
        ("cs2", "ence",           "ENCE",           "ence"),
        ("cs2", "og",             "OG",             "og"),
        # Aliases xử lý cách viết academy / clan / gaming (đã strip suffix, chỉ
        # để cover trường hợp bên này viết đủ, bên kia viết tắt/không):
        ("cs2", "aaa",            "against All authority", "againstallauthority"),
        ("cs2", "natusvincere",   "Natus Vincere",  "natusvincere"),
    ]
