# deHieu

Server-side sports data polling platform (matches / scores / markets / odds) + CLI client.

## Kiến trúc

```
┌─────────── Docker stack (server) ──────────────────────────┐
│                                                             │
│  poller ──HTTP──► sptpub API ──► TimescaleDB               │
│                                     ▲                       │
│                                     │                       │
│                                api (FastAPI)                │
│                                     │                       │
│                                     ▼                       │
│                        nginx-mtls :9443 (TLS 1.3 + mTLS)    │
│                                     │                       │
│  chrome (optional, profile=browser) │                       │
└─────────────────────────────────────┼───────────────────────┘
                                      │
                                 https (client cert)
                                      │
                                 ┌────▼────┐
                                 │  CLI    │  Rich REPL
                                 └─────────┘
```

- **poller**: 4 async loop trong 1 process — `live` (1s), `prematch` (30s),
  `descriptors` (market dict + statuses + per-event player names),
  `status` (heartbeat log). Ghi thẳng TimescaleDB, không dùng pub/sub.
- **api**: FastAPI REST — `/api/matches`, `/api/matches/{id}/scores`,
  `/api/platforms/{platform}/matches/{slug}/odds`.
- **client**: REPL Python, gọi REST qua mTLS.

Schema DB tách 2 namespace:
- `public` — source-of-truth thông tin từ csgoempire: sports, categories,
  tournaments, competitors, matches, score_events, period_scores.
- `odds`  — markets/odds platform-agnostic: market_descriptors, players,
  event_market_overrides, status_labels, odds_current, odds_history
  (Timescale hypertable). Sau này add platform khác chỉ việc INSERT với
  `platform='<name>'`.

## Bước cài

### Server

```bash
cd docker
cp ../server.env.example ../server.env      # sửa cookie + device_id + TOTP
bash scripts/gen-certs.sh localhost         # sinh CA + server + client cert
docker compose up -d --build
```

3 container chạy: `timescaledb`, `poller`, `api`, `nginx-mtls`.

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
>>> odds csgoempire alliance-3dmax-2715306923066007564
>>> quit
```

## Layout

```
deHieu/
├── docker/               # compose + nginx + Dockerfiles
├── server/               # poller + api (Python)
│   ├── common/           # config, db, models
│   ├── poller/           # auth, sptpub_client, parser, loop
│   └── api/              # app, routes_query, routes_odds
├── client                # client REPL
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
- [x] Odds + markets ingestion (piggy-back trên live/prematch payload)
- [x] Per-event descriptions (player name mapping cho player-props)
- [ ] Chrome-based login flow (phase 2) — refresh cookie khi hết hạn
- [ ] Continuous aggregates của Timescale (score changes/hour/tournament)
- [ ] Auth mTLS cho REST đã có sẵn qua nginx; API có thể check X-Client-CN
- [ ] WebSocket streaming (phase sau — thêm lại Redis khi cần)
