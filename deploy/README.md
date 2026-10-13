# Web trên Vercel, NestJS trên VPS Ubuntu 26.04 LTS

**VPS không chạy web.** VPS chạy một NestJS bằng pnpm + systemd, PostgreSQL và Dragonfly dùng Docker Compose có sẵn.
Vercel build/phục vụ ứng dụng trong `web/`. Không chạy `pnpm --filter arb-ops-web start` trên VPS.

## 1. Hai bên nối với nhau thế nào?

Ví dụ domain backend là `api.example.com`; thay domain này bằng domain thật trong các bước dưới.
Web dùng URL `ten-project.vercel.app` hoặc domain riêng trỏ về Vercel.

```text
Trình duyệt --HTTPS--> Web trên Vercel
                         |
                         +--HTTPS + API token--> api.example.com --> NestJS :3000
                         |
                         +--HTTPS xin vé WS----> api.example.com --> NestJS :3000

Trình duyệt --WSS + vé một lần--> api.example.com/admin-ws --> NestJS :3003
```

- REST: trình duyệt gọi `/api/backend/*` trên web; Next.js gắn token người dùng rồi gọi VPS qua HTTPS.
- Realtime: web xin vé qua `/api/ws-ticket`; trình duyệt mở **thẳng WSS tới VPS**, không đi xuyên Vercel Function.
- Vé dùng một lần, sống 60 giây. API token dài hạn chỉ nằm trên server, không đưa xuống trình duyệt.
- Backend không cần gọi ngược tới Vercel hay cấu hình domain web. BFF hiện tại không cần bật CORS REST.
- HTTPS/WSS dùng cho mọi kết nối qua internet. Proxy tới NestJS qua HTTP/WS trên `127.0.0.1` là nội bộ cùng máy.
- Chỉ chạy **một instance NestJS** vì vé, task registry và một phần trạng thái vận hành nằm trong RAM.

## 2. Chuẩn bị VPS và DNS

SSH vào VPS bằng tài khoản có `sudo`. Tạo DNS `A` cho `api.example.com` tới IPv4 VPS.
Chỉ tạo `AAAA` nếu VPS có IPv6 hoạt động. Web domain vẫn trỏ về Vercel, không trỏ về VPS.
Các lệnh dưới chạy trên **Linux VPS**, không phải terminal Windows local.

```bash
sudo apt update
sudo apt install -y git curl ca-certificates openssl nano ufw
sudo adduser --disabled-password --gecos "" arbops
sudo install -d -o arbops -g arbops /opt/arb-ops
```

Mở SSH **trước** khi bật firewall. Nếu SSH không dùng cổng 22, thay rule đầu bằng cổng thực tế.
Kiểm tra rule hiện có trước nếu VPS còn phục vụ ứng dụng khác.

```bash
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable
sudo ufw status
```

Firewall của nhà cung cấp cũng phải mở SSH, 80, 443.
**Không mở 3000–3003, 3100, 5432, 6379 ra internet.** Compose đã bind database/cache vào localhost;
không bỏ `127.0.0.1` vì Docker publish cổng công khai có thể đi vòng qua UFW.

## 3. pnpm, Node và lấy code

```bash
sudo -iu arbops
curl -fsSL https://get.pnpm.io/install.sh -o /tmp/arb-pnpm-install.sh
env PNPM_VERSION=12.10.0 ENV="$HOME/.bashrc" SHELL=/bin/bash bash /tmp/arb-pnpm-install.sh
export PNPM_HOME="$HOME/.local/share/pnpm"
export PATH="$PNPM_HOME/bin:$PATH"
pnpm runtime set node 24 -g
node --version
pnpm --version
git clone YOUR_GIT_REPOSITORY_URL /opt/arb-ops
cd /opt/arb-ops
pnpm install --frozen-lockfile
```

Thay URL repo; repo private cần SSH key/deploy key có quyền đọc.
Code đang sửa trên Windows phải commit/push trước để VPS và Vercel lấy được.
Repo pin pnpm **12.10.0**, Node **24.x**; SDK Polymarket hiện yêu cầu Node >=24.
Không cài `--prod` trước build: Nest CLI/TypeScript cần devDependencies.
Ứng dụng chạy bằng user `arbops`, không chạy bằng root.

## 4. Tạo cấu hình hai bên

Ở `/opt/arb-ops`, user `arbops`, tạo hash mật khẩu admin web rồi chạy script cấu hình:

```bash
read -rsp 'Mat khau admin web: ' WEB_PASSWORD
printf '\n'
pnpm --filter arb-ops-web hash-password "$WEB_PASSWORD"
unset WEB_PASSWORD
pnpm exec node deploy/configure-env.mjs
```

Script hỏi domain API, tên admin và hash vừa tạo (`scrypt$16384$...`).
Nó tạo token/mật khẩu ngẫu nhiên riêng biệt và hai file quyền `600`:

| File | Dùng ở đâu? |
| --- | --- |
| `/opt/arb-ops/.env` | Backend, Docker Compose và migration trên VPS |
| `/opt/arb-ops/deploy/.env.vercel` | Giá trị nhập vào Environment Variables của Vercel |

**Không ghi đè file có sẵn.** Nếu đã có cấu hình/database, sửa file hiện có;
không đổi mật khẩu DB tùy tiện vì PostgreSQL volume đã khởi tạo không đổi mật khẩu theo `.env` mới.
Hai file đã gitignore; sao lưu riêng tư, không gửi nội dung vào chat/log công khai.

Script tự nối `WEB_USERS[].apiToken` với token trong `API_TOKENS` của backend, và đặt:

```dotenv
BACKEND_URL=https://api.example.com
BACKEND_ADMIN_WS_URL=wss://api.example.com/admin-ws
```

Backend có `HTTP_BIND_HOST=127.0.0.1` và `WS_BIND_HOST=127.0.0.1`, để chỉ proxy vào được.

## 5. Database, cache, migration và build

Cài Docker Engine + Compose plugin từ apt repository chính thức theo
[Docker cho Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
Không dùng convenience script dành cho thử nghiệm. Quay về tài khoản SSH có sudo:

```bash
exit
sudo docker version
sudo docker compose version
sudo systemctl enable --now docker
cd /opt/arb-ops
sudo docker compose up -d
sudo docker compose ps
sudo docker compose logs --tail=50 postgres dragonfly
```

Đợi PostgreSQL `healthy`, Dragonfly không restart lặp lại, rồi migrate/build:

```bash
sudo -iu arbops
cd /opt/arb-ops
pnpm db:migrate
pnpm build
exit
```

Migration đọc `.env` ở gốc. Build ở gốc **chỉ build NestJS**, không build web trên VPS.
PostgreSQL lưu dữ liệu trong volume `postgres_data`; Dragonfly là cache RAM, không có snapshot bền vững.
**Không chạy `docker compose down -v`**, vì sẽ xóa volume database.

## 6. Chạy NestJS bằng systemd

```bash
sudo install -m 644 /opt/arb-ops/deploy/systemd/arb-backend.service /etc/systemd/system/arb-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now arb-backend
sudo systemctl status arb-backend --no-pager
curl --fail http://127.0.0.1:3000/health
sudo ss -lntp
```

`/health` phải trả HTTP 200 và `status: ok`; 503 nghĩa là database/cache chưa khỏe.
Cổng 3000–3003 phải chỉ nghe trên `127.0.0.1`. systemd tự chạy sau reboot và restart khi lỗi.
Service dùng pnpm `/home/arbops/.local/share/pnpm/bin/pnpm`, không phụ thuộc nvm/shell tương tác.
Nếu đổi user/thư mục, sửa `User`, `Group`, `WorkingDirectory`, `PATH`, `PNPM_HOME`, `ExecStart`.

## 7. HTTPS/WSS: chọn một proxy

**Chọn Caddy hoặc Nginx, không bật cả hai trên 80/443.** Caddy tự lo chứng chỉ, Nginx dùng Certbot.
Cả hai hỗ trợ REST và ba kênh WebSocket. `pnpm deploy` trong package.json là Nest Mau, không phải deploy VPS này.

### Cách A: Caddy

Cài theo [Caddy cho Debian/Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian), rồi:

```bash
sudo install -d -o caddy -g caddy /var/log/caddy
sudo cp /opt/arb-ops/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
sudo caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
curl --fail https://api.example.com/health
```

Thay mọi `api.example.com` bằng domain thật. DNS và 80/443 phải thông, Caddy tự xin/gia hạn chứng chỉ.
Không cài Certbot/renew hook khi dùng Caddy.
Nếu Caddy đã phục vụ dịch vụ khác, sao lưu và thêm block API, không ghi đè toàn bộ file đang dùng.

### Cách B: Nginx + Certbot

Lần đầu **chưa có chứng chỉ**, dùng HTTP bootstrap trước, không bật ngay cấu hình TLS:

```bash
sudo apt install -y nginx certbot
sudo install -d /var/www/letsencrypt /etc/nginx/snippets
sudo cp /opt/arb-ops/deploy/nginx-bootstrap.conf /etc/nginx/sites-available/arb-api
sudo nano /etc/nginx/sites-available/arb-api
sudo ln -s /etc/nginx/sites-available/arb-api /etc/nginx/sites-enabled/arb-api
sudo nginx -t
sudo systemctl enable --now nginx
sudo systemctl reload nginx
sudo certbot certonly --webroot -w /var/www/letsencrypt --cert-name arb-ops -d api.example.com
```

Thay domain trong editor **và** lệnh Certbot. Giữ `--cert-name arb-ops` để khớp đường dẫn chứng chỉ trong proxy.
Nếu symlink đã tồn tại thì bỏ lệnh `ln -s`; sao lưu cấu hình đang dùng trước khi thay thế.
Sau khi có chứng chỉ:

```bash
sudo cp /opt/arb-ops/deploy/nginx.conf /etc/nginx/sites-available/arb-api
sudo cp /opt/arb-ops/deploy/snippets/arb-ws.conf /etc/nginx/snippets/arb-ws.conf
sudo nano /etc/nginx/sites-available/arb-api
sudo nginx -t
sudo systemctl reload nginx
sudo install -m 755 /opt/arb-ops/deploy/certbot-renew-hook.sh /etc/letsencrypt/renewal-hooks/deploy/arb-nginx.sh
sudo systemctl enable --now certbot.timer
sudo certbot renew --dry-run
curl --fail https://api.example.com/health
```

Lại thay domain trong editor. Hook reload Nginx sau gia hạn; route challenge được giữ trong cấu hình TLS.

## 8. Deploy web trên Vercel

Import repo Git, đặt:

| Cài đặt | Giá trị |
| --- | --- |
| Framework | Next.js |
| Root Directory | `web` |
| Include source files outside Root Directory | Bật, để thấy workspace/lockfile gốc |
| Node.js | 24.x |
| Install Command | `pnpm install --frozen-lockfile` |
| Build Command | `pnpm run build` |
| Output Directory | Mặc định Next.js |

`web/vercel.json` khai báo framework/install/build. Root Directory phải đặt trên dashboard.
Không deploy NestJS vào Vercel, không dùng `pnpm start` hay process manager cho web trên Vercel.

Mở riêng `deploy/.env.vercel` trên VPS bằng editor. Trong **Project > Settings > Environment Variables**,
nhập giá trị bên phải dấu `=` cho từng key:

| Key | Giá trị/ý nghĩa |
| --- | --- |
| `BACKEND_URL` | `https://DOMAIN_BACKEND`, không phải localhost/cổng 3000 |
| `BACKEND_ADMIN_WS_URL` | `wss://DOMAIN_BACKEND/admin-ws` |
| `SESSION_SECRET` | Khóa cookie ngẫu nhiên >=32 ký tự |
| `WEB_USERS` | JSON một dòng có hash và token khớp backend |
| `ARB_MOCK` | `false` |
| `NEXT_PUBLIC_ENV_LABEL` | `Production` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`, dùng pnpm đã pin ở package.json gốc |

Trong dashboard, `WEB_USERS` là nguyên JSON, **không thêm nháy đơn bao quanh, không thêm `\` trước `$`**.
`.env.vercel` chứa giá trị cho dashboard, **không `source` và không đổi tên thành `.env.local`**;
Next.js đọc file local sẽ expand `$` trong hash, cần escape riêng cho trường hợp local.
Không thêm `NEXT_PUBLIC_` vào bí mật. Đặt `SESSION_SECRET`/`WEB_USERS` thành Secret/Sensitive nếu có.

Chọn **Production**, sau đó Deploy/Redeploy. Đổi env chỉ có hiệu lực với deployment mới.
Preview nên dùng backend/tài khoản riêng hoặc viewer, không cấp admin production cho mọi PR.
Không đưa `DATABASE_URL`, mật khẩu PostgreSQL/Redis hay `TASK_WS_TOKEN` lên Vercel: web không cần chúng.

## 9. Kiểm tra kết nối thật

1. `curl --fail https://DOMAIN_BACKEND/health` trả HTTP 200.
2. Mở URL HTTPS của Vercel, đăng nhập tài khoản ở bước 4, không dùng `demo/demo`.
3. DevTools > Network: request `/api/backend/admin/snapshot` trả 200 với dữ liệu thật.
4. `/api/ws-ticket` trả `mode: stream`, URL `wss://DOMAIN_BACKEND/admin-ws`.
5. Network > WS: status **101**; Messages có `welcome`, `snapshot`, sau đó `metrics`/`event`.
6. Tạo/chạy publisher trong Publisher & Node; ingest tăng, dữ liệu trận/room cập nhật.

`/api/ws-ticket` là route trên **web Vercel**; BFF gọi `POST /admin/ws-ticket` trên NestJS.
Vercel không cần mở cổng WebSocket hay proxy stream của VPS.

| Lỗi | Kiểm tra |
| --- | --- |
| HTTPS lỗi chứng chỉ | DNS A/AAAA, 80/443, proxy log, domain trên chứng chỉ |
| 502 | Backend chưa chạy hoặc proxy nhầm cổng |
| `/health` 503 | DB/cache, `DATABASE_URL`, `REDIS_URL` |
| REST 401/403 | Token `WEB_USERS` khớp `API_TOKENS`, role/quyền đúng |
| Vẫn là dữ liệu mẫu | `ARB_MOCK=false` và Redeploy |
| Login thất bại | JSON `WEB_USERS`, hash có nguyên dấu `$`, mật khẩu đúng |
| WS không có 101 | URL WSS, snippet Upgrade/Connection, proxy cổng 3003 |
| Chỉ polling | Thiếu/sai URL WSS, vé hết hạn, backend vừa restart |
| `EADDRINUSE` | `sudo ss -lntp`; không chạy thêm `pnpm start:prod` cạnh systemd |

## 10. Log, cập nhật và backup

```bash
sudo journalctl -u arb-backend -n 100 --no-pager
sudo journalctl -u arb-backend -f
sudo docker compose -f /opt/arb-ops/docker-compose.yml --env-file /opt/arb-ops/.env logs --tail=100
```

Backend giữ task registry và một số settings trong RAM; mặc định xóa room khi khởi động lại.
Sau restart/reboot cần tạo/chạy lại publisher và kiểm tra settings; lịch sử PostgreSQL vẫn giữ.
Cập nhật đơn giản dưới đây **có khoảng dừng**, chưa phải zero downtime:

```bash
sudo systemctl stop arb-backend
sudo -iu arbops
cd /opt/arb-ops
git pull --ff-only
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
exit
sudo systemctl start arb-backend
curl --fail https://api.example.com/health
```

Chỉ start sau khi build/migration thành công. Backup DB trước migration; rollback code không tự rollback schema.
Web cập nhật bằng push tới nhánh production của Vercel. Đổi API token thì cập nhật `WEB_USERS` và Redeploy;
đổi `SESSION_SECRET` sẽ đăng xuất các phiên cũ.

Backup PostgreSQL, từ `/opt/arb-ops` bằng tài khoản quản trị:

```bash
umask 077
sudo docker compose exec -T postgres pg_dump -U postgres -d deHieu -Fc > "$HOME/arb-ops-$(date +%F-%H%M%S).dump"
```

Đưa backup ra nơi khác VPS, mã hóa và thử phục hồi định kỳ. Sao lưu `.env`/cấu hình Vercel riêng tư.
Không dùng `docker compose down -v` để cập nhật.

## Kênh khác và giới hạn

| Kênh | URL public | Bí mật |
| --- | --- | --- |
| REST/admin | `https://DOMAIN_BACKEND`, `wss://DOMAIN_BACKEND/admin-ws` | API token; trình duyệt chỉ giữ vé một lần |
| Task-runner từ xa | `wss://DOMAIN_BACKEND/task-ws` | `TASK_WS_TOKEN` |
| Bot consumer | `wss://DOMAIN_BACKEND/consumer-ws` | `CONSUMER_WS_TOKEN` |

Task-runner cùng VPS có thể dùng `ws://127.0.0.1:3001`. Không cần runner riêng nếu dùng publisher chế độ worker.
Token từng kênh nên khác nhau (script đã làm). Không có hello hợp lệ sau 10s thì bị ngắt;
frame admin/consumer tối đa 64 KB, publisher theo `TASK_WS_MAX_PAYLOAD_MB` (mặc định 64 MB).

## Nguồn chính thức

- [pnpm installation](https://pnpm.io/installation), [pnpm runtime](https://pnpm.io/cli/runtime).
- [Docker Ubuntu](https://docs.docker.com/engine/install/ubuntu/), [Ubuntu TLS/Certbot](https://ubuntu.com/server/docs/how-to/security/obtain-tls-certificates/).
- [Caddy installation](https://caddyserver.com/docs/install), [Nginx WebSocket proxy](https://nginx.org/en/docs/http/websocket.html).
- [Vercel monorepos](https://vercel.com/docs/monorepos), [build/Corepack](https://vercel.com/docs/builds/configure-a-build).
