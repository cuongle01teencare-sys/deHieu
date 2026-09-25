"""Command handlers (async)."""
import asyncio
from client.cli.ui import console, render_matches, render_scores, event_line


HELP = """\
[bold cyan]Commands[/]
  [bold]matches[/] [tournament=<id>] [limit=<n>]   List matches
  [bold]match[/] <id>                              Show 1 match info
  [bold]scores[/] <id> [since=<iso>] [limit=<n>]   Score history của 1 trận
  [bold]stream[/] [match=<id>]                     Subscribe live events (Ctrl-C để dừng)
  [bold]health[/]                                  Ping server
  [bold]help[/]                                    Bảng này
  [bold]quit[/] / [bold]exit[/]                    Thoát
"""


def _kv(args: str) -> dict:
    out = {}
    for tok in args.split():
        if "=" in tok:
            k, v = tok.split("=", 1)
            out[k] = v
    return out


async def cmd_help(ctx, _):    console.print(HELP)

async def cmd_health(ctx, _):
    console.print(await ctx.api.health())

async def cmd_matches(ctx, args):
    kv = _kv(args)
    rows = await ctx.api.list_matches(
        tournament=kv.get("tournament"), limit=int(kv.get("limit", 50)),
    )
    render_matches(rows)

async def cmd_match(ctx, args):
    mid = args.strip()
    if not mid: console.print("[red]Usage:[/] match <id>"); return
    console.print(await ctx.api.get_match(mid))

async def cmd_scores(ctx, args):
    parts = args.strip().split(maxsplit=1)
    if not parts: console.print("[red]Usage:[/] scores <id> [since=<iso>]"); return
    mid = parts[0]
    kv = _kv(parts[1]) if len(parts) > 1 else {}
    rows = await ctx.api.scores(mid, since=kv.get("since"), limit=int(kv.get("limit", 500)))
    render_scores(mid, rows)

async def cmd_stream(ctx, args):
    kv = _kv(args)
    mid = kv.get("match")
    console.print(f"[cyan]▶ streaming {'all' if not mid else mid}. Ctrl-C to stop.[/]")
    try:
        async for msg in ctx.api.stream(match_id=mid):
            console.print(event_line(msg))
    except (KeyboardInterrupt, asyncio.CancelledError):
        console.print("[dim]stream stopped.[/]")


COMMANDS = {
    "help": cmd_help, "?": cmd_help,
    "health": cmd_health,
    "matches": cmd_matches, "ls": cmd_matches,
    "match": cmd_match,
    "scores": cmd_scores,
    "stream": cmd_stream, "tail": cmd_stream,
}
