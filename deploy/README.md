# Triển khai backend sau reverse proxy TLS

Backend mở 4 cổng: REST (3000) và 3 WebSocket server (3001 publisher, 3002 consumer, 3003 admin).
Token của mọi kênh đi trong nội dung frame/header → **bắt buộc mã hóa (HTTPS/WSS) khi qua internet**,
và trình duyệt chạy HTTPS (web trên Vercel) không được phép mở `ws://`.

Chọn **một** trong hai: [`Caddyfile`](./Caddyfile) (đơn giản, tự lo chứng chỉ) hoặc [`nginx.conf`](./nginx.conf).

## Các bước

1. Trỏ DNS `api.example.com` về máy chạy backend.
2. Trong `.env` của backend đặt `WS_BIND_HOST=127.0.0.1`; app (REST) chạy với `PORT=3000` trên localhost.
   Firewall chỉ mở **80** và **443** (cổng 3000–3003, 5432, 6379 không mở ra ngoài).
3. Cài Caddy hoặc Nginx với file cấu hình ở đây (thay `api.example.com`).
4. Cập nhật địa chỉ ở các bên kết nối vào:

| Bên | Biến | Giá trị |
| --- | --- | --- |
| Web (Vercel) | `BACKEND_URL` | `https://api.example.com` |
| Web (Vercel) | `BACKEND_ADMIN_WS_URL` | `wss://api.example.com/admin-ws` |
| Node task-runner | `TASK_RUNNER_APP_URL` | `wss://api.example.com/task-ws` |
| Bot consumer (ngoài repo) | URL kết nối | `wss://api.example.com/consumer-ws` |

Node task-runner chạy **cùng máy** với app thì giữ `ws://127.0.0.1:3001` (không cần đi qua proxy).

## Bí mật theo từng kênh

| Kênh | Bí mật | Ai giữ |
| --- | --- | --- |
| REST + admin stream | `API_TOKENS` (mỗi người một token) | Backend; web giữ token của từng người trong `WEB_USERS` (chỉ server Next.js) |
| Admin stream từ trình duyệt | Vé một lần, sống 60s (`POST /admin/ws-ticket`) | Không cần cấu hình |
| Publisher → app | `TASK_WS_TOKEN` (dùng chung) | Backend + mọi node task-runner |
| App → consumer | `CONSUMER_WS_TOKEN` (dùng chung) | Backend + bot |

Nên dùng giá trị **khác nhau** cho từng loại (lộ một cái không mở được kênh khác). Tạo bằng `openssl rand -hex 32`.

## Giới hạn chống lạm dụng (đã có trong code)

- Mọi token so sánh thời gian hằng (`safeEqual` / `timingSafeEqual`).
- Chưa gửi `hello` hợp lệ trong 10s → bị ngắt (cả 3 kênh WS).
- Kích thước frame tối đa: admin 64 KB, consumer 64 KB, publisher `TASK_WS_MAX_PAYLOAD_MB` (mặc định 64 MB,
  vì snapshot/trang danh sách trận lớn). Vượt → đóng kết nối mã 1009.
- Vé admin lưu trong RAM của tiến trình → chạy **một** instance backend. Nhiều instance thì phải chuyển vé sang Redis.
