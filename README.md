# deHieu

Server-side score polling platform + CLI client.

## Kiến trúc

```
┌─────────── Docker stack (server) ──────────────────────────┐
│                                                             │
│  poller ──HTTP──► sptpub API ──► TimescaleDB               │
│     │                                ▲                      │
│     └── publish ──► Redis ──► api (FastAPI)                │
│                                      │                      │
│                                      ▼                      │
│                         nginx-mtls :9443 (TLS 1.3 + mTLS)   │
│                                      │                      │
│  chrome (optional, profile=browser)  │                      │
└──────────────────────────────────────┼──────────────────────┘
                                       │
                              wss/https (client cert)
                                       │
                                  ┌────▼────┐
                                  │  CLI    │  Rich REPL
                                  └─────────┘
```

- **poller**: loop async, gọi `/api/v4/live/brand/{id}/en/{version}`, ghi TimescaleDB, publish sang Redis khi có event
- **api**: FastAPI với REST (`/api/matches`) và WS (`/events`) — WS chỉ subscribe Redis rồi fanout
- **client**: REPL Python, gọi REST + WS qua mTLS

## Bước cài

### Server

```bash
cd docker
cp ../server.env.example ../server.env      # sửa password + creds
bash scripts/gen-certs.sh vps.example.com
docker compose up -d --build
```

### Client

Project dùng [uv](https://docs.astral.sh/uv/) + dependency groups (xem `pyproject.toml`).

```bash
uv sync --group client               # cài deps cho REPL (default group)
cp config.example.yaml config.yaml   # trỏ base_url tới server
uv run python -m main
```

## Commands REPL

```
>>> health
>>> matches limit=20
>>> match 2714859373016002596
>>> scores 2714859373016002596 limit=100
>>> stream                                   # tail all events
>>> stream match=2714859373016002596        # tail 1 trận
>>> quit
```

## Layout

```
deHieu/
├── docker/               # compose + nginx + Dockerfiles
├── server/               # poller + api (Python)
│   ├── common/           # config, db, redis_bus, models
│   ├── poller/           # auth, sptpub_client, parser, loop
│   └── api/              # app, routes_query, routes_stream
├── client                  # client REPL
│   ├── cli/              # repl, commands, ui
│   ├── core/             # api_client, connection (TLS)
│   └── config.py
├── main.py               # client entry
├── config.example.yaml   # client
├── server.env.example    # server
├── pyproject.toml        # uv + dependency groups (client/server/dev)
└── uv.lock
```

## Roadmap

- [x] Poll HTTP thuần, giữ Chrome ở compose profile
- [ ] Chrome-based login flow (phase 2) — refresh cookie khi hết hạn
- [ ] Continuous aggregates của Timescale (score changes/hour/tournament)
- [ ] Auth mTLS cho REST/WS đã có sẵn qua nginx; API có thể check X-Client-CN
- [ ] Consumer example (Slack/Discord webhook khi có bàn thắng)
