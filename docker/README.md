# deHieu server stack

5 container + 1 optional:

```
┌── nginx-mtls :9443 (public, TLS 1.3 + mTLS) ─┐
│                                              │
├── api        :8080 internal (fastapi)        │  ← REST + WS
├── poller     internal (asyncio loop)         │  ← poll sptpub
├── redis      :6379 internal (pub/sub only)   │
├── timescaledb :5432 internal (pg16 + TSDB)   │
└── chrome     :9222 internal (profile=browser)│  ← optional, cho token refresh phase 2
```

## Chuẩn bị

```bash
cd docker
cp ../server.env.example ../server.env
# → sửa POSTGRES_PASSWORD, CSGO_USERNAME/PASSWORD

bash scripts/gen-certs.sh <server_hostname>   # sinh certs vào docker/certs/
```

## Chạy

```bash
docker compose up -d --build              # 5 service chính
docker compose --profile browser up -d    # thêm chrome khi cần
docker compose logs -f poller             # xem poller đang làm gì
docker compose logs -f api
```

## Test

```bash
# health
curl --cert ../certs/client.crt --key ../certs/client.key --cacert ../certs/ca.crt \
     https://localhost:9443/health

# list matches
curl --cert ... https://localhost:9443/api/matches?limit=10
```

## Ghi chú phase 1

Endpoint `POST /api/v2/auth/login` của csgoempire dính Cloudflare Turnstile —
tạm thời `AuthClient.login()` raise NotImplementedError. Cách work-around:
- Copy cookie `csgo_session` từ browser (F12 → Application → Cookies) và inject
  vào `AuthClient.csgo.cookies` khi khởi động (dev only).
- Phase 2: bật `--profile browser`, viết flow Chrome-based login → set cookie
  vào httpx jar.
