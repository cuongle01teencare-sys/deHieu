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
`?from=push`). `lib/push.ts` nạp OneSignal Web SDK v16 sau khi đăng nhập nếu có App ID.
OneSignal dùng worker riêng tại `public/push/onesignal/OneSignalSDKWorker.js`, scope `/push/onesignal/`,
để không thay thế worker PWA. Bản chụp snapshot cuối lưu cục bộ để mở app khi offline.

## Chạy local

```bash
pnpm install                 # ở thư mục gốc repo (workspace gồm web/) — package.json đã thêm thư viện mới
cp web/.env.example web/.env.local
# chế độ dữ liệu mẫu, không cần backend: ARB_MOCK=true → đăng nhập demo / demo
pnpm --filter arb-ops-web dev
```

Nối backend thật: đặt `BACKEND_URL`, `BACKEND_ADMIN_WS_URL`, `SESSION_SECRET`, `WEB_USERS`
(`pnpm --filter arb-ops-web hash-password '<mật khẩu>'` để tạo `passwordHash`).

## OneSignal Web Push cho PWA

1. Tạo app trong OneSignal, cấu hình nền tảng **Web**, chọn **Custom Code** và đặt **Site URL**
   đúng origin của web (scheme, domain và port). Dùng HTTPS khi deploy. Khi thử local, cấu hình
   app OneSignal riêng cho `http://localhost:3000` (hoặc port dev thực tế).
2. Điền App ID từ **Settings > Keys & IDs** vào `web/.env`:

   ```dotenv
   NEXT_PUBLIC_ONESIGNAL_APP_ID=your-onesignal-app-id
   ```

   Nếu dùng `web/.env.local`, file này có độ ưu tiên cao hơn `.env`. Để trống App ID thì SDK
   không được nạp. App ID là giá trị công khai; REST API Key phải giữ ở server, không dùng
   tiền tố `NEXT_PUBLIC_`.
3. Restart dev server. Trên Vercel, thêm cùng biến vào Environment Variables của project web
   rồi build/deploy lại vì Next.js đóng gói biến `NEXT_PUBLIC_*` lúc build.
4. Đảm bảo `/push/onesignal/OneSignalSDKWorker.js` trả về JavaScript công khai, không chuyển
   hướng sang trang đăng nhập. Path và scope đã được cấu hình trong `OneSignal.init()`;
   không cần chèn thêm SDK script hoặc đăng ký worker thủ công.
5. Đăng nhập web, mở **Thông báo**, bấm **Bật thông báo** và chấp nhận quyền. Trên iPhone/iPad
   cần iOS/iPadOS 16.4+ và mở PWA đã thêm vào Màn hình chính. Trạng thái chỉ báo đã bật khi
   có subscription ID và subscription đã opt in, không chỉ dựa vào quyền trình duyệt.
6. Trong OneSignal dashboard, chọn subscription vừa tạo và gửi một push thử, sau đó đóng
   PWA để kiểm tra nhận thông báo và chạm vào URL của web. Nút **Thử trên thiết bị** trong
   app chỉ kiểm tra hiển thị cục bộ, không kiểm tra đường gửi từ OneSignal.

SDK khởi tạo một lần mỗi lần tải trang, không tự bật prompt hoặc chuông của OneSignal.
Tùy chọn được lưu local và đồng bộ thành sáu user tag: `critical`, `warning`, `signals`,
`signal_threshold`, `anomalies`, `delivery_prefs`. Tag cuối chứa JSON `{ quiet, actionable }`;
`quiet` là chuỗi `HH:mm-HH:mm` hoặc rỗng. Mã gửi phía server cần đọc và áp dụng các tùy chọn
này; tag không tự thực hiện giờ yên lặng hoặc lọc margin. Hiện scope này chỉ tích hợp SDK
và đăng ký thiết bị; chưa tự gửi sự cố/kèo từ NestJS và chưa liên kết external ID tài khoản.

Kiểm tra logic SDK: `pnpm --filter arb-ops-web test:push`.
Tham khảo [Custom Code setup](https://documentation.onesignal.com/docs/en/web-push-custom-code-setup)
và [service worker](https://documentation.onesignal.com/docs/en/onesignal-service-worker).

## Kiến trúc

- Chi tiết trận: `/tran-dau/{match}`; chi tiết dòng kèo: `/tran-dau/{match}?market={market}`.
  Ví dụ `/tran-dau/cs2%3Aalliance~sinners?market=map-1-winner`. URL mở lại đúng drawer và hỗ trợ Back/Forward.
- Link tenant dùng `lines[tenant].ref.url`, mở tab mới với `noopener noreferrer`.
  CSGOEmpire ghép `bt-path` từ slug sport/category/tournament/event gốc trong feed và event ID;
  Polymarket dùng slug event, không dùng slug market con. Thiếu metadata thì không đoán URL.
  Dòng cũ cần snapshot/descriptor mới từ backend để có `ref.url`.
- Kiểm tra URL và contract chi tiết trận: `pnpm --filter arb-ops-web test:match-links`.

- **BFF:** trình duyệt chỉ gọi `/api/backend/*` bằng cookie phiên; server Next.js gắn token API
  của người dùng (`WEB_USERS[].apiToken`) và chuyển tiếp tới backend. Token không tới trình duyệt.
- **Realtime:** `/api/ws-ticket` xin vé một lần (`POST /admin/ws-ticket`), trình duyệt mở thẳng
  `BACKEND_ADMIN_WS_URL` và gửi `{ type: "hello", ticket }`. Không có URL stream hoặc mất kết nối →
  tự thăm dò REST (snapshot 5s, ingest 2s) và kết nối lại theo backoff.
- **PWA:** `app/manifest.ts` + icon, worker gốc `/sw.js` và worker OneSignal ở scope riêng.

## Deploy Vercel

Hướng dẫn đầy đủ: [Vercel web + NestJS trên VPS Ubuntu](../deploy/README.md).
`web/vercel.json` khai báo build/install bằng pnpm; chọn Node 24.x và bật
`ENABLE_EXPERIMENTAL_COREPACK=1` để dùng pnpm đã pin ở package.json gốc.

Root Directory = `web`, framework Next.js, khai báo các biến trong `.env.example`.
Backend phải mở qua **HTTPS** (REST) và **WSS** (admin stream) — đặt reverse proxy có TLS trước
cổng 3000 và 3003.
