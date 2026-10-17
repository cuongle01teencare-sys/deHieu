# Web trên Vercel, NestJS trên VPS Ubuntu 26.04 LTS

**VPS không chạy web hoặc PostgreSQL.** VPS chạy một NestJS bằng pnpm + systemd; Docker Compose chỉ chạy Dragonfly.
PostgreSQL nằm trên **Supabase**, backend kết nối bằng `DATABASE_URL` qua TLS.
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

NestJS trên VPS --PostgreSQL qua TLS--> Supabase
NestJS trên VPS --Redis nội bộ-------> Dragonfly 127.0.0.1:6379
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
**Không mở 3000–3003, 3100, 5432, 6379 ra internet.** Compose đã bind cache vào localhost;
không bỏ `127.0.0.1` vì Docker publish cổng công khai có thể đi vòng qua UFW.
VPS kết nối **đi ra** Supabase, không cần mở cổng PostgreSQL đi vào VPS.

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

Trong Supabase, mở project > **Connect**, chọn connection string dạng URI PostgreSQL:

- VPS chỉ có IPv4: chọn **Session pooler**, cổng `5432`.
- Có IPv6 hoạt động hoặc Supabase IPv4 add-on: có thể dùng **Direct connection**.
- Không chọn **Transaction pooler** (`6543`): driver hiện tại dùng prepared statements.

Đây là URL bắt đầu bằng `postgresql://`, **không phải** URL HTTPS/API key của Supabase.
Thay chỗ mật khẩu bằng mật khẩu database thật; percent-encode ký tự đặc biệt trong mật khẩu
(ví dụ `@` thành `%40`, `#` thành `%23`). Giữ đúng host và username Supabase cung cấp.
Xem [các kiểu kết nối Supabase](https://supabase.com/docs/guides/database/connecting-to-postgres).

Ở `/opt/arb-ops`, user `arbops`, tạo hash mật khẩu admin web rồi chạy script cấu hình.
Lệnh `read -rsp` không hiện giá trị bạn nhập, tránh ghi connection string vào lịch sử lệnh:

```bash
read -rsp 'Mat khau admin web: ' WEB_PASSWORD
printf '\n'
pnpm --filter arb-ops-web hash-password "$WEB_PASSWORD"
unset WEB_PASSWORD
read -rsp 'Supabase connection string: ' DATABASE_URL
printf '\n'
export DATABASE_URL
pnpm exec node deploy/configure-env.mjs
unset DATABASE_URL
```

Script hỏi domain API, tên admin và hash vừa tạo (`scrypt$16384$...`).
Nó giữ connection string Supabase bạn nhập, thêm `sslmode=require` nếu chưa có;
tạo riêng token ứng dụng, mật khẩu Redis, khóa session và hai file quyền `600`.
`sslmode=require` mã hóa kết nối; muốn xác minh chứng chỉ server cần CA tin cậy và cấu hình xác minh phù hợp,
không coi chế độ này là xác minh đầy đủ danh tính server.

| File | Dùng ở đâu? |
| --- | --- |
| `/opt/arb-ops/.env` | Backend, Docker Compose và migration trên VPS |
| `/opt/arb-ops/deploy/.env.vercel` | Giá trị nhập vào Environment Variables của Vercel |

**Không ghi đè file có sẵn.** Nếu đã có cấu hình/database, sửa file hiện có;
giữ nguyên token và khóa session. Mật khẩu trong URL phải khớp database Supabase, script không đổi mật khẩu trên Supabase.
Hai file đã gitignore; sao lưu riêng tư, không gửi nội dung vào chat/log công khai.

Script tự nối `WEB_USERS[].apiToken` với token trong `API_TOKENS` của backend, và đặt:

```dotenv
BACKEND_URL=https://api.example.com
BACKEND_ADMIN_WS_URL=wss://api.example.com/admin-ws
```

Backend có `HTTP_BIND_HOST=127.0.0.1` và `WS_BIND_HOST=127.0.0.1`, để chỉ proxy vào được.

## 5. Database, cache, migration và build

Cài Docker Engine + Compose plugin từ apt repository chính thức theo
[Docker cho Ubuntu](https://docs.docker.com/engine/install/ubuntu/) (có hỗ trợ Ubuntu 26.04 LTS).
Không cần Docker Desktop trên VPS.

### 5.1. Quay về tài khoản quản trị

User `arbops` chỉ chạy ứng dụng, không có quyền sudo theo cấu hình này.
Nếu prompt đang là `arbops@...`, chạy `exit` **một lần** để quay về root/tài khoản SSH có sudo:

```bash
exit
```

Nếu prompt đã là `root@...`, **bỏ qua `exit`** để không đóng phiên SSH.
Các lệnh cài đặt dưới chạy bằng root hoặc tài khoản quản trị có sudo.
Nếu máy từng cài `docker.io`, `podman-docker`, `containerd` hoặc `runc` từ nguồn khác,
kiểm tra/gỡ gói xung đột theo tài liệu Docker trước; không gỡ mù trên máy đang chạy container khác.

### 5.2. Thêm repository và cài Docker

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc

sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF

sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

Dán nguyên block `sudo tee ... <<EOF` tới dòng `EOF`; shell tự lấy codename của Ubuntu.
Không thay codename bằng bản Ubuntu khác nếu apt báo không tìm thấy repository.

### 5.3. Khởi động và kiểm tra

```bash
sudo systemctl enable --now docker
sudo systemctl status docker --no-pager
sudo docker version
sudo docker compose version
sudo docker run --rm hello-world
```

Docker service phải `active (running)`; `docker version` có cả Client và Server,
`hello-world` in thông báo thành công. Nếu có lỗi, xử lý trước khi đi tiếp.
Dùng **`docker compose`**, không phải `docker-compose`. Giữ `sudo` khi quản lý container;
không cần cấp nhóm Docker (quyền gần tương đương root) cho user ứng dụng `arbops`.

### 5.4. Chạy Dragonfly (cache)

Vẫn dùng tài khoản quản trị, `.env` phải đã được tạo ở bước 4:

```bash
cd /opt/arb-ops
sudo docker compose up -d dragonfly
sudo docker compose ps
sudo docker compose logs --tail=50 dragonfly
```

Dragonfly phải chạy ổn định, không restart lặp lại. Không có container PostgreSQL cần khởi động.

### 5.5. Migration và build backend

Kiểm tra `DATABASE_URL` trỏ đúng project Supabase và backup trước khi thay đổi schema.
Nếu project đã chứa dữ liệu/bảng của ứng dụng khác, kiểm tra migration để tránh xung đột.
Chuyển về user ứng dụng:

```bash
sudo -iu arbops
cd /opt/arb-ops
pnpm db:migrate
pnpm build
exit
```

Migration đọc `.env` ở gốc và cập nhật schema **trên Supabase**. Nó không chuyển dữ liệu từ database khác sang.
Build ở gốc **chỉ build NestJS**, không build web trên VPS.
Database do Supabase lưu trữ; Dragonfly là cache RAM, không có snapshot bền vững.

### 5.6. Nếu đã deploy PostgreSQL local theo hướng dẫn cũ

Không chạy lại script tạo env: bạn đã có token khớp với Vercel.
Sau khi commit/push thay đổi ở máy local, trên VPS dùng tài khoản quản trị:

```bash
sudo systemctl stop arb-backend
sudo -iu arbops
cd /opt/arb-ops
git pull --ff-only
nano .env
```

Trong editor, thay **chỉ** `DATABASE_URL` bằng connection string Supabase, đặt trong nháy đơn,
thêm `?sslmode=require` (hoặc `&sslmode=require` nếu URL đã có query).
Xóa dòng `POSTGRES_PASSWORD` cũ; giữ nguyên `API_TOKENS`, `REDIS_PASSWORD`, `REDIS_URL` và các token khác.
Không gửi connection string lên Vercel hay commit vào Git.

Nếu database local có dữ liệu cần giữ, backup và chuyển dữ liệu riêng trước khi chạy app trên Supabase;
**đổi URL và chạy migration không tự chuyển dữ liệu**. Sau khi kiểm tra/backup database đích:

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm db:migrate
exit
sudo docker compose -f /opt/arb-ops/docker-compose.yml --env-file /opt/arb-ops/.env up -d dragonfly
sudo systemctl start arb-backend
curl --fail http://127.0.0.1:3000/health
curl --fail https://dehieu-api.duckdns.org/health
```

Chỉ đi tiếp khi từng lệnh thành công; thay domain ở lệnh cuối nếu bạn dùng domain khác.
Nếu migration thất bại, không start backend. Nếu `/health` lỗi, xem log và xử lý trước khi dừng database cũ.
Khi health trả 200 và đã xác nhận dữ liệu Supabase đúng, kiểm tra container cũ bằng `sudo docker ps -a`.
Nếu đúng container PostgreSQL của app này có tên `postgres`, dừng bằng `sudo docker stop postgres`.
Giữ lại container/volume cũ để đối chiếu; không dùng `--remove-orphans`, `down -v` hoặc `docker volume prune` để chuyển đổi.
Không cần đổi cấu hình HTTPS/WSS của Caddy hay Vercel.

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

### 6.1. Xem Chromium trên VPS qua noVNC

SeleniumBase mặc định tự tạo Xvfb ngẫu nhiên trên Linux. Để noVNC bám đúng Chrome của backend,
dùng display cố định `:99` với Xauthority riêng. VNC và noVNC chỉ nghe loopback; không mở cổng
`5900` hoặc `6080` trên UFW/firewall nhà cung cấp.

```bash
sudo apt update
sudo apt install -y xvfb xauth x11-utils x11vnc novnc websockify
sudo -iu arbops x11vnc -storepasswd
sudo install -m 644 /opt/arb-ops/deploy/systemd/arb-xvfb.service /etc/systemd/system/arb-xvfb.service
sudo install -m 644 /opt/arb-ops/deploy/systemd/arb-x11vnc.service /etc/systemd/system/arb-x11vnc.service
sudo install -m 644 /opt/arb-ops/deploy/systemd/arb-novnc.service /etc/systemd/system/arb-novnc.service
sudo install -m 644 /opt/arb-ops/deploy/systemd/arb-backend.service /etc/systemd/system/arb-backend.service
sudo systemctl daemon-reload
sudo systemctl enable --now arb-xvfb arb-x11vnc arb-novnc
sudo systemctl restart arb-backend
```

Nếu trước đó đã chạy `websockify`, `x11vnc` hoặc Xvfb `:99` bằng `nohup`, xem PID bằng
`sudo ss -lntp` và `ps` rồi dừng đúng tiến trình thủ công trước khi bật service để tránh `Address already in use`.
Không dừng các Xvfb khác khi chưa xác nhận chúng thuộc ứng dụng này.

```bash
sudo systemctl status arb-xvfb arb-x11vnc arb-novnc arb-backend --no-pager
sudo -u arbops env DISPLAY=:99 XAUTHORITY=/run/arb-xvfb/Xauthority xdpyinfo >/dev/null
nc -vz 127.0.0.1 5900
curl --fail http://127.0.0.1:6080/vnc.html >/dev/null
sudo ss -lntp | grep -E ':(5900|6080)'
```

Trên máy Windows, tạo tunnel từ máy cá nhân tới loopback của VPS; không chạy lệnh này bên trong VPS:

```powershell
ssh -N -L 6081:127.0.0.1:6080 root@dehieu-api.duckdns.org
```

Mở `http://127.0.0.1:6081/vnc.html?autoconnect=1&resize=scale` và nhập mật khẩu VNC đã tạo.
Không gửi file `/run/arb-xvfb/Xauthority`, `/home/arbops/.vnc/passwd`, cookie hoặc JWT vào log/chat.

## 7. HTTPS/WSS: chọn một proxy

**Chọn Caddy hoặc Nginx, không bật cả hai trên 80/443.** Caddy tự lo chứng chỉ, Nginx dùng Certbot.
Cả hai hỗ trợ REST và ba kênh WebSocket. `pnpm deploy` trong package.json là Nest Mau, không phải deploy VPS này.

### Cách A: Caddy

Cài bằng apt repository stable chính thức của
[Caddy cho Debian/Ubuntu](https://caddyserver.com/docs/install#debian-ubuntu-raspbian).
Chạy bằng root/tài khoản quản trị có sudo, không phải user `arbops`.
Gói apt cài binary, user/group `caddy` và service systemd; không cần tự tạo user này.

**A.1. Cài Caddy trước**

```bash
sudo apt update
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https ca-certificates curl gnupg
curl -1fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key -o /tmp/caddy-stable.gpg.key
sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg /tmp/caddy-stable.gpg.key
sudo curl -1fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt -o /etc/apt/sources.list.d/caddy-stable.list
sudo chmod 644 /usr/share/keyrings/caddy-stable-archive-keyring.gpg /etc/apt/sources.list.d/caddy-stable.list
sudo apt update
sudo apt install -y caddy
caddy version
id caddy
```

Chỉ đi tiếp nếu các lệnh thành công. `id caddy` phải hiển thị user/group `caddy`.
Nếu báo `install: invalid user: 'caddy'` thì bước cài chưa hoàn tất; không sửa bằng cách tạo thư mục log thuộc root.
Nếu đã cài repository và gpg hỏi ghi đè key, kiểm tra đó đúng là key Caddy trước khi đồng ý.
Gói apt có thể tự khởi động Caddy; nếu 80/443 đang do Nginx/dịch vụ khác sử dụng, giải quyết xung đột trước,
không dừng dịch vụ đang phục vụ ứng dụng khác khi chưa kiểm tra.

**A.2. Tạo log và cấu hình domain**

```bash
sudo install -d -o caddy -g caddy /var/log/caddy
sudo cp /opt/arb-ops/deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile
```

Thay mọi `api.example.com` bằng domain thật, ví dụ `dehieu-api.duckdns.org`.
Nếu Caddy đã phục vụ dịch vụ khác, sao lưu và thêm block API, không ghi đè toàn bộ file đang dùng.

**A.3. Kiểm tra và khởi động HTTPS/WSS**

```bash
sudo -u caddy -H caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo systemctl enable --now caddy
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
curl --fail https://api.example.com/health
```

Thay domain trong lệnh `curl` nữa. DNS và 80/443 phải thông, Caddy tự xin/gia hạn chứng chỉ.
Validate bằng user `caddy` để file log được tạo với đúng chủ sở hữu, không phải root.
Không cài Certbot/renew hook khi dùng Caddy.
Nếu service lỗi hoặc HTTPS chưa chạy, đọc `sudo journalctl -u caddy -n 100 --no-pager`.
Không bỏ kiểm tra TLS bằng `curl -k` để coi việc deploy đã thành công.

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
| Supabase `ENETUNREACH`/timeout | VPS không có IPv6 thì dùng Session pooler 5432; kiểm tra DNS, kết nối đi ra và IP allowlist nếu bật |
| Lỗi prepared statement | Không dùng Transaction pooler 6543; lấy URI Direct/Session trong Supabase Connect |
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
Sau restart/reboot cần tạo/chạy lại publisher và kiểm tra settings; lịch sử trong Supabase vẫn giữ.
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

Backup database **trên Supabase**, không dùng `docker compose exec postgres` nữa.
Kiểm tra backup khả dụng ở **Database > Backups** theo gói của project.
Với gói Free, chủ động xuất dữ liệu định kỳ bằng Supabase CLI `db dump` theo
[hướng dẫn backup](https://supabase.com/docs/guides/platform/backups) và
[backup/restore bằng CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore).
Đưa bản xuất ra nơi khác VPS/Supabase, mã hóa và thử phục hồi định kỳ.
Sao lưu `.env`/cấu hình Vercel riêng tư; không xóa volume PostgreSQL cũ khi chưa kiểm tra dữ liệu và backup.

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
- [Supabase connections](https://supabase.com/docs/guides/database/connecting-to-postgres), [Supabase backups](https://supabase.com/docs/guides/platform/backups).
