# deHieu server stack

4 container + 1 optional:

```
┌── nginx-mtls  :9443  (public, TLS 1.3 + mTLS)  ─┐
│                                                 │
├── api         :8080  internal (fastapi)         │  ← REST
├── poller      internal (asyncio loops)          │  ← poll sptpub
├── timescaledb :5432  internal (pg16 + TSDB)     │
└── chrome      :9222  internal (profile=browser) │  ← optional, cho token refresh phase 2
```

## Chuẩn bị

```bash
cd docker
cp ../server.env.example ../server.env
# → sửa CSGO_COOKIE_HEADER, CSGO_DEVICE_ID, CSGO_TOTP_SECRET

bash scripts/gen-certs.sh <server_hostname>   # sinh certs vào docker/certs/
```

## Chạy

```bash
docker compose up -d --build              # 4 service chính
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

# odds của 1 trận
curl --cert ... \
     "https://localhost:9443/api/platforms/csgoempire/matches/alliance-3dmax-2715306923066007564/odds"
```

## Ghi chú phase 1

Endpoint `POST /api/v2/auth/login` của csgoempire dính Cloudflare Turnstile —
tạm thời `AuthClient.login()` raise NotImplementedError. Cách work-around:
- Copy cookie `csgo_session` từ browser (F12 → Application → Cookies) và inject
  vào `AuthClient.csgo.cookies` khi khởi động (dev only).
- Phase 2: bật `--profile browser`, viết flow Chrome-based login → set cookie
  vào httpx jar.

## Note — tạo volume mới

Mỗi lần tạo volume `dehieu_pgdata` mới (VD sau `docker compose down -v`),
phải **chown volume về UID 1000** TRƯỚC khi `up`, không thì timescaledb boot
fail với `Permission denied`:

```bash
docker volume create dehieu_pgdata
MSYS_NO_PATHCONV=1 docker run --rm --user 0 --entrypoint chown \
    -v dehieu_pgdata:/pgdata \
    timescale/timescaledb-ha:pg16 \
    -R 1000:1000 /pgdata
docker compose up -d
```
(Bỏ `MSYS_NO_PATHCONV=1` nếu chạy trong PowerShell/cmd.)
