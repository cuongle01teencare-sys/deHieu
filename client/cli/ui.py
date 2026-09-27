"""Rich formatters."""
from rich.console import Console
from rich.table import Table
from rich.panel import Panel

console = Console()


def banner(server_url: str, mtls: bool):
    console.print(Panel.fit(
        f"[bold cyan]deHieu[/] client REPL\n"
        f"[dim]server:[/] {server_url}   [dim]auth:[/] {'mTLS 1.3' if mtls else 'plain'}\n"
        "[dim]Type[/] [bold]help[/] [dim]for commands, [/][bold]quit[/] [dim]to exit.[/]",
        border_style="cyan",
    ))


_PHASE_STYLE = {
    "live":     "[bold green]live[/]",
    "prematch": "[cyan]prematch[/]",
    "ended":    "[dim]ended[/]",
}


def _phase_badge(phase) -> str:
    return _PHASE_STYLE.get(phase or "", "[dim]-[/]")


def _mid(r) -> str:
    """MatchDTO alias 'id'→'match_id'; support cả 2 key."""
    return r.get("id") or r.get("match_id") or "?"


def _score(r) -> str:
    h, a = r.get("home_score"), r.get("away_score")
    if h is None and a is None:
        return "-"
    return f"{h if h is not None else '?'}-{a if a is not None else '?'}"


def render_matches(rows, mode: str = "default"):
    """3 mode: 'narrow' (chỉ core), 'default' (như trước), 'wide' (full id + tournament + score)."""
    if not rows:
        console.print("[dim]Không có trận nào.[/]"); return

    t = Table(show_header=True, header_style="bold magenta", expand=False)

    if mode == "narrow":
        cols = ("id", "phase", "home", "away")
        [t.add_column(c) for c in cols]
        for r in rows:
            mid = _mid(r)
            t.add_row(
                (mid[:12] + "…") if len(mid) > 12 else mid,
                _phase_badge(r.get("phase")),
                (r.get("home_name") or "?")[:20],
                (r.get("away_name") or "?")[:20],
            )
    elif mode == "wide":
        cols = ("id", "phase", "sport", "tournament", "home", "away", "score", "scheduled", "last_seen")
        [t.add_column(c) for c in cols]
        for r in rows:
            t.add_row(
                _mid(r),                                                 # full id
                _phase_badge(r.get("phase")),
                str(r.get("sport_name") or r.get("sport_id") or "-"),
                (r.get("tournament_name") or "-")[:30],
                (r.get("home_name") or "?")[:24], (r.get("away_name") or "?")[:24],
                _score(r),
                str(r.get("scheduled_at") or "-")[:19],
                str(r.get("last_seen_at") or "-")[:19],
            )
    else:  # default
        cols = ("id", "phase", "sport", "home", "away", "scheduled", "last_seen")
        [t.add_column(c) for c in cols]
        for r in rows:
            mid = _mid(r)
            t.add_row(
                (mid[:16] + "…") if len(mid) > 16 else mid,
                _phase_badge(r.get("phase")),
                str(r.get("sport_id") or "-"),
                (r.get("home_name") or "?")[:24], (r.get("away_name") or "?")[:24],
                str(r.get("scheduled_at") or "-")[:19],
                str(r.get("last_seen_at") or "-")[:19],
            )
    console.print(t)
    console.print(f"[dim]{len(rows)} rows[/]")


def render_stats(data: dict):
    """Panel + table cho stats overview."""
    phases_line = (
        f"[bold green]{data.get('phase_live', 0)}[/] live   "
        f"[cyan]{data.get('phase_prematch', 0)}[/] prematch   "
        f"[dim]{data.get('phase_ended', 0)}[/] ended   "
        f"[dim]{data.get('phase_null', 0)}[/] unknown"
    )
    console.print(Panel.fit(
        f"[bold]Matches:[/] {data.get('matches_total', 0)}   {phases_line}\n"
        f"[dim]virtual:[/] {data.get('virtual_count', 0)}   "
        f"[dim]with odds:[/] {data.get('matches_with_odds', 0)}",
        title="[bold]Overview[/]", border_style="cyan",
    ))
    t = Table(show_header=True, header_style="bold magenta", expand=False)
    t.add_column("resource"); t.add_column("count", justify="right")
    for label, key in [
        ("sports",                   "sports_count"),
        ("tournaments",              "tournaments_count"),
        ("competitors",              "competitors_count"),
        ("score events",             "score_events_count"),
        ("odds.odds_current",        "odds_current_count"),
        ("odds.odds_history",        "odds_history_count"),
        ("odds.market_descriptors",  "market_descriptors_count"),
        ("odds.players",             "players_count"),
    ]:
        t.add_row(label, f"{data.get(key, 0):,}")
    console.print(t)
    if data.get("last_score_ts") or data.get("last_odds_ts"):
        console.print(
            f"[dim]last score:[/] {str(data.get('last_score_ts') or '—')[:19]}   "
            f"[dim]last odds:[/] {str(data.get('last_odds_ts') or '—')[:19]}"
        )


def render_find(text: str, data: dict):
    """3 nhóm: matches / tournaments / players."""
    console.print(f"[bold]Search:[/] [yellow]{text}[/]")

    ms = data.get("matches") or []
    if ms:
        console.print(f"\n[bold cyan]Matches ({len(ms)})[/]")
        t = Table(show_header=True, header_style="bold magenta", expand=False)
        for c in ("id", "phase", "slug", "home", "away", "tournament", "scheduled"):
            t.add_column(c)
        for r in ms:
            mid = r.get("match_id") or r.get("id") or "?"
            t.add_row(
                (mid[:16] + "…") if len(mid) > 16 else mid,
                _phase_badge(r.get("phase")),
                (r.get("slug") or "-")[:30],
                (r.get("home_name") or "?")[:20],
                (r.get("away_name") or "?")[:20],
                (r.get("tournament_name") or "-")[:24],
                str(r.get("scheduled_at") or "-")[:19],
            )
        console.print(t)

    ts = data.get("tournaments") or []
    if ts:
        console.print(f"\n[bold cyan]Tournaments ({len(ts)})[/]")
        t = Table(show_header=True, header_style="bold magenta", expand=False)
        for c in ("id", "name", "slug", "tier"):
            t.add_column(c)
        for r in ts:
            t.add_row(
                r.get("id", "?"), (r.get("name") or "-")[:40],
                (r.get("slug") or "-")[:30], r.get("tier") or "-",
            )
        console.print(t)

    ps = data.get("players") or []
    if ps:
        console.print(f"\n[bold cyan]Players ({len(ps)})[/]")
        t = Table(show_header=True, header_style="bold magenta", expand=False)
        for c in ("player_id", "name", "competitor_id"):
            t.add_column(c)
        for r in ps:
            t.add_row(
                (r.get("player_id") or "-")[:50], r.get("name") or "-",
                r.get("competitor_id") or "-",
            )
        console.print(t)

    if not (ms or ts or ps):
        console.print("[dim]Không có kết quả nào.[/]")


def render_scores(mid: str, rows):
    console.print(f"[bold]Match[/] {mid}   [dim]({len(rows)} events)[/]")
    if not rows:
        return
    t = Table(show_header=True, header_style="bold magenta")
    for c in ("ts", "home", "away", "period", "match_status"):
        t.add_column(c)
    for r in rows[:30]:
        t.add_row(str(r["ts"])[:23],
                  str(r.get("home_score")), str(r.get("away_score")),
                  str(r.get("period") or "-"), str(r.get("match_status") or "-"))
    console.print(t)


def render_odds(data: dict) -> None:
    """In markets + odds ra dạng grouped: 1 panel/match, 1 table/market."""
    home = data.get("home", {}).get("name") or "?"
    away = data.get("away", {}).get("name") or "?"
    st = data.get("status") or {}
    st_txt = f"{st.get('label') or '—'} (code={st.get('code')})"
    console.print(Panel.fit(
        f"[bold]{home}[/]  vs  [bold]{away}[/]   {_phase_badge(data.get('phase'))}\n"
        f"[dim]platform:[/] {data.get('platform')}   "
        f"[dim]match_id:[/] {data.get('match_id')}   "
        f"[dim]slug:[/] {data.get('slug') or '—'}\n"
        f"[dim]status:[/] {st_txt}   "
        f"[dim]markets:[/] {data.get('markets_count')}   "
        f"[dim]outcomes:[/] {data.get('outcomes_count')}",
        border_style="cyan",
    ))
    markets = data.get("markets") or []
    if not markets:
        console.print("[dim]Không có market/odds nào cho trận này.[/]")
        return
    for mk in markets:
        title = mk.get("market_label") or f"market {mk['market_id']}"
        spec = mk.get("specifier") or {}
        spec_txt = " ".join(f"{k}={v}" for k, v in spec.items())
        header = f"[bold]{title}[/]  [dim]#{mk['market_id']}[/]"
        if spec_txt:
            header += f"  [dim]{spec_txt}[/]"
        console.print(header)
        t = Table(show_header=True, header_style="bold magenta", box=None,
                  pad_edge=False)
        for c in ("outcome", "odds"):
            t.add_column(c)
        for o in mk.get("outcomes", []):
            odds = o.get("odds")
            odds_txt = f"[bold green]{odds:.2f}[/]" if odds is not None else "-"
            t.add_row(o.get("label") or o.get("outcome_id"), odds_txt)
        console.print(t)
        console.print()


