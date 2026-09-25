"""deHieu client — REPL kết nối tới deHieu server."""
import argparse
import sys

from client.cli.repl import run_repl
from client.config import load_config


def main():
    p = argparse.ArgumentParser(prog="deHieu-client")
    p.add_argument("--config", default="config.yaml")
    p.add_argument("--base-url", help="Override server.base_url")
    p.add_argument("--ws-url",   help="Override server.ws_url")
    args = p.parse_args()

    try:
        cfg = load_config(args.config)
    except FileNotFoundError:
        print(f"[!] {args.config} not found. Copy config.example.yaml → config.yaml")
        sys.exit(1)

    if args.base_url: cfg.server.base_url = args.base_url
    if args.ws_url:   cfg.server.ws_url = args.ws_url

    run_repl(cfg)


if __name__ == "__main__":
    main()
