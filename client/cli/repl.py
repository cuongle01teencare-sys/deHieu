"""REPL loop (async): prompt_toolkit + asyncio."""
import asyncio
from pathlib import Path

from prompt_toolkit import PromptSession
from prompt_toolkit.completion import WordCompleter
from prompt_toolkit.history import FileHistory
from prompt_toolkit.patch_stdout import patch_stdout

from client.cli.ui import console, banner
from client.cli.commands import COMMANDS
from client.config import AppConfig
from client.core.api_client import ApiClient


class Ctx:
    def __init__(self, api): self.api = api


async def _run(cfg: AppConfig):
    banner(cfg.server.base_url, bool(cfg.server.tls))
    api = ApiClient(cfg.server)
    ctx = Ctx(api)

    hist = Path.home() / ".dehieu_client_history"
    session = PromptSession(
        history=FileHistory(str(hist)),
        completer=WordCompleter(list(COMMANDS.keys()) + ["quit", "exit"], ignore_case=True),
    )

    while True:
        try:
            with patch_stdout():
                line = await session.prompt_async(">>> ")
        except (EOFError, KeyboardInterrupt):
            console.print(); break
        line = line.strip()
        if not line: continue
        cmd, _, args = line.partition(" ")
        cmd = cmd.lower()
        if cmd in ("quit", "exit", "q"): break
        h = COMMANDS.get(cmd)
        if not h:
            console.print(f"[red]Unknown:[/] {cmd}. [dim]Type[/] help"); continue
        try:
            await h(ctx, args)
        except KeyboardInterrupt:
            console.print("[dim]interrupted[/]")
        except Exception as e:
            console.print(f"[red]Error:[/] {e}")

    await api.close()
    console.print("[cyan]Bye.[/]")


def run_repl(cfg: AppConfig):
    asyncio.run(_run(cfg))
