"""Rich formatters."""
from rich.console import Console
from rich.table import Table
from rich.panel import Panel
from rich.text import Text

console = Console()


def banner(server_url: str, mtls: bool):
    console.print(Panel.fit(
        f"[bold cyan]deHieu[/] client REPL\n"
        f"[dim]server:[/] {server_url}   [dim]auth:[/] {'mTLS 1.3' if mtls else 'plain'}\n"
        "[dim]Type[/] [bold]help[/] [dim]for commands, [/][bold]quit[/] [dim]to exit.[/]",
        border_style="cyan",
    ))


def render_matches(rows):
    if not rows:
        console.print("[dim]Không có trận nào.[/]"); return
    t = Table(show_header=True, header_style="bold magenta", expand=False)
    for c in ("id", "sport", "home", "away", "scheduled", "last_seen"):
        t.add_column(c)
    for r in rows:
        t.add_row(
            r["id"][:16] + "...", str(r.get("sport_id") or "-"),
            (r.get("home_name") or "?")[:24], (r.get("away_name") or "?")[:24],
            str(r.get("scheduled_at") or "-")[:19],
            str(r.get("last_seen_at") or "-")[:19],
        )
    console.print(t)


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


def event_line(msg: dict) -> Text:
    channel = msg.get("channel", "?")
    data = msg.get("data", {})
    if channel == "scores.updated":
        color = "green"
        s = f"{data.get('home_score')}–{data.get('away_score')}  p{data.get('period') or '?'}  {data.get('match_id')}"
    elif channel == "matches.new":
        color = "cyan"
        s = f"NEW MATCH  {data.get('home','?')} vs {data.get('away','?')}  ({data.get('match_id')})"
    elif channel == "poller.status":
        color = "yellow"
        s = f"iter={data.get('iteration')} seen={data.get('matches_seen')}"
    else:
        color = "white"
        s = str(data)[:120]
    return Text.assemble((f"[{channel}] ", color), s)
