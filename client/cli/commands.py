"""Command handlers (async)."""
import json as _json

import httpx

from client.cli.ui import (
    console, render_matches, render_scores, render_odds,
    render_stats, render_find,
)


HELP = """\
[bold cyan]Commands[/]
  [bold]matches[/] [filters...] [display...] [limit=<n>]
      filters:  phase=live|prematch|ended|active|unknown   virtual=true|false
                sport=<id/slug/name>                       tournament=<id/name>
                team=<name>      has_odds=true     since=<iso>  until=<iso>
                                             active  = live + prematch
                                             unknown = phase IS NULL (trận cũ chưa được poller set)
      alias:    live | prematch | ended | active   (= phase=<x>)
                has_odds                                    (= has_odds=true)
      display:  wide | narrow | format=json | format=raw   count
      VD:  matches live limit=10
           matches phase=prematch team=alliance wide
           matches ended virtual=false format=json

  [bold]match[/] <id>                              Show 1 match info
  [bold]scores[/] <id> [since=<iso>] [limit=<n>]   Score history của 1 trận
  [bold]odds[/] <platform> <slug>                  Markets + odds hiện tại
                                             VD: odds csgoempire alliance-3dmax-2715306923066007564
  [bold]stats[/]                                   Dashboard: count trận / odds / players / ...
  [bold]find[/] <text>                             Search matches + tournaments + players
  [bold]health[/]                                  Ping server
  [bold]help[/]                                    Bảng này
  [bold]quit[/] / [bold]exit[/]                    Thoát
"""


# Aliases: token dạng flag (không có `=`) → dict entries.
# Cho phép gõ `matches live wide has_odds` thay vì `matches phase=live wide has_odds=true`.
_ALIASES = {
    "live":     {"phase": "live"},
    "prematch": {"phase": "prematch"},
    "ended":    {"phase": "ended"},
    "active":   {"phase": "active"},       # = live + prematch (server-side alias)
    "has_odds": {"has_odds": "true"},
    "virtual":  {"virtual": "true"},
    "real":     {"virtual": "false"},
}

_DISPLAY_TOKENS = {"wide", "narrow", "count", "raw"}


def _parse(args: str) -> tuple[dict, set]:
    """Tokenize args. Trả (filters_dict, display_flags_set).
    - `key=value` → filters[key]=value
    - `wide` / `narrow` / `count` / `raw` → display flag
    - `live` / `prematch` / … → alias, expand vào filters
    Unknown positional token bị bỏ qua với warning."""
    filters: dict = {}
    display: set = set()
    for tok in args.split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            filters[k.strip()] = v.strip()
        elif tok in _DISPLAY_TOKENS:
            display.add(tok)
        elif tok in _ALIASES:
            filters.update(_ALIASES[tok])
        else:
            console.print(f"[dim yellow]warning:[/] unknown token '{tok}' — bỏ qua")
    return filters, display


def _extract_detail(exc: httpx.HTTPStatusError) -> str:
    """Rút `detail` từ JSON body của FastAPI HTTPException."""
    try:
        body = exc.response.json()
        if isinstance(body, dict) and "detail" in body:
            return str(body["detail"])
    except Exception:
        pass
    return exc.response.text[:200] or exc.response.reason_phrase


async def cmd_help(ctx, _):    console.print(HELP)

async def cmd_health(ctx, _):
    console.print(await ctx.api.health())


async def cmd_matches(ctx, args):
    filters, display = _parse(args)
    # Normalize known bools
    for k in ("virtual", "has_odds"):
        if k in filters:
            filters[k] = filters[k].lower() in ("true", "1", "yes", "y")
    # `format=` cũng đi vào display
    fmt = filters.pop("format", None)
    if fmt: display.add(fmt)
    # Coerce limit
    if "limit" in filters:
        try: filters["limit"] = int(filters["limit"])
        except ValueError: filters["limit"] = 50

    # `count` chạy endpoint /matches/count (SQL count, bỏ qua limit)
    if "count" in display:
        # Bỏ limit khỏi filters — count không bị cap
        cnt_filters = {k: v for k, v in filters.items() if k != "limit"}
        data = await ctx.api.matches_count(**cnt_filters)
        console.print(f"[bold]{data.get('count', 0):,}[/] matches (filters: {cnt_filters or 'none'})")
        return

    rows = await ctx.api.list_matches(**filters)

    if "json" in display or "raw" in display:
        console.print_json(_json.dumps(rows, default=str))
        return
    mode = "wide" if "wide" in display else ("narrow" if "narrow" in display else "default")
    render_matches(rows, mode=mode)


async def cmd_match(ctx, args):
    mid = args.strip()
    if not mid: console.print("[red]Usage:[/] match <id>"); return
    console.print(await ctx.api.get_match(mid))


async def cmd_scores(ctx, args):
    parts = args.strip().split(maxsplit=1)
    if not parts: console.print("[red]Usage:[/] scores <id> [since=<iso>]"); return
    mid = parts[0]
    filters, _ = _parse(parts[1]) if len(parts) > 1 else ({}, set())
    rows = await ctx.api.scores(
        mid, since=filters.get("since"),
        limit=int(filters.get("limit", 500)),
    )
    render_scores(mid, rows)


async def cmd_odds(ctx, args):
    parts = args.strip().split(maxsplit=1)
    if len(parts) < 2:
        console.print("[red]Usage:[/] odds <platform> <slug>")
        console.print("[dim]VD:[/] odds csgoempire alliance-3dmax-2715306923066007564")
        return
    platform, slug = parts[0], parts[1].strip()
    try:
        data = await ctx.api.odds(platform, slug)
    except httpx.HTTPStatusError as e:
        code = e.response.status_code
        detail = _extract_detail(e)
        if code == 404:
            console.print(f"[yellow]Không tìm thấy trận:[/] {slug}")
            console.print(f"[dim]{detail}[/]")
            console.print("[dim]Kiểm tra:[/]")
            console.print("[dim]  - Slug có kết thúc bằng match_id (≥15 chữ số) không?[/]")
            console.print("[dim]  - Poller đã chạy đủ lâu để bắt trận này chưa? Thử `matches` xem có ID tương tự.[/]")
        elif code >= 500:
            console.print(f"[red]Server lỗi ({code}):[/] {detail}")
            console.print("[dim]Xem `docker compose logs api --tail=30` để chi tiết.[/]")
        else:
            console.print(f"[red]HTTP {code}:[/] {detail}")
        return
    render_odds(data)


async def cmd_stats(ctx, _):
    data = await ctx.api.stats()
    render_stats(data)


async def cmd_find(ctx, args):
    text = args.strip()
    if not text:
        console.print("[red]Usage:[/] find <text>"); return
    data = await ctx.api.find(text)
    render_find(text, data)


COMMANDS = {
    "help": cmd_help, "?": cmd_help,
    "health": cmd_health,
    "matches": cmd_matches, "ls": cmd_matches,
    "match": cmd_match,
    "scores": cmd_scores,
    "odds": cmd_odds,
    "stats": cmd_stats,
    "find": cmd_find, "search": cmd_find,
}
