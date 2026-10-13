# Arb Ops — web (Next.js)

Bảng điều khiển vận hành (responsive + PWA). Thiết kế theo `docs/ui-design-prompt.md`:
"control room" tĩnh lặng — không bọc thẻ, nhóm bằng khoảng trắng + hairline, dark mặc định, light tương đương.

**Công nghệ:** Next.js 16 · React 19 · Tailwind CSS v4 (tokens trong `app/globals.css`) · Radix (`radix-ui`,
tương thích shadcn/ui — xem `components.json`) · vaul (bottom sheet) · cmdk (⌘K) · sonner (toast) · Recharts · lucide-react.

**Màn hình:** Tổng quan · Luồng dữ liệu (Sankey theo tenant) · Trận đấu · Chi tiết trận (ma trận market × tenant) ·
Room drawer · Ghép trượt · Kèo (trực tiếp + lịch sử) · Publisher & Node · Consumer · Sự cố · Audit · Lịch sử odds ·
Cài đặt arbitrage · Bí danh đội · Thông báo (tùy chọn push) · Hệ thống thiết kế (`/thiet-ke`, kèm mẫu push trên màn hình khóa) · Đăng nhập.

**Cấu trúc:** `components/ui/*` = component trình bày (props vào, không gọi API) · `components/<màn>/*` = màn hình ·
`components/shell/*` = khung, ⌘K, thông báo, PWA · `lib/mock.ts` = dữ liệu mẫu đủ cho mọi màn.

**Quyền:** nút thiếu quyền bị khóa kèm tooltip tên quyền. Quyền lấy từ `WEB_USERS[].permissions`, hoặc suy từ
`role` (admin/manager/staff/viewer như backend). Người dùng demo thiếu `tasks:command` để thấy trạng thái này.

**PWA / push:** `app/manifest.ts`, icon trong `public/icons/`, `public/sw.js` (push + bấm thông báo mở đúng màn với
`?from=push`). `lib/push.ts` là lớp mỏng cho OneSignal: nạp OneSignal Web SDK (và `importScripts` SDK trong `sw.js`)
là các hàm tự dùng SDK. Bản chụp snapshot cuối lưu cục bộ để mở app khi offline.

## Chạy local

```bash
pnpm install                 # ở thư mục gốc repo (workspace gồm web/) — package.json đã thêm thư viện mới
cp web/.env.example web/.env.local
# chế độ dữ liệu mẫu, không cần backend: ARB_MOCK=true → đăng nhập demo / demo
pnpm --filter arb-ops-web dev
```

Nối backend thật: đặt `BACKEND_URL`, `BACKEND_ADMIN_WS_URL`, `SESSION_SECRET`, `WEB_USERS`
(`pnpm --filter arb-ops-web hash-password '<mật khẩu>'` để tạo `passwordHash`).

## Kiến trúc

- **BFF:** trình duyệt chỉ gọi `/api/backend/*` bằng cookie phiên; server Next.js gắn token API
  của người dùng (`WEB_USERS[].apiToken`) và chuyển tiếp tới backend. Token không tới trình duyệt.
- **Realtime:** `/api/ws-ticket` xin vé một lần (`POST /admin/ws-ticket`), trình duyệt mở thẳng
  `BACKEND_ADMIN_WS_URL` và gửi `{ type: "hello", ticket }`. Không có URL stream hoặc mất kết nối →
  tự thăm dò REST (snapshot 5s, ingest 2s) và kết nối lại theo backoff.
- **PWA:** `app/manifest.ts` + icon; service worker và OneSignal sẽ thêm khi làm thông báo đẩy.

## Deploy Vercel

Root Directory = `web`, framework Next.js, khai báo các biến trong `.env.example`.
Backend phải mở qua **HTTPS** (REST) và **WSS** (admin stream) — đặt reverse proxy có TLS trước
cổng 3000 và 3003.
