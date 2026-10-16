import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url(),
  /**
   * Số kết nối Postgres tối đa của MỘT tiến trình backend. Supabase pooler cổng 5432 (session mode)
   * giới hạn tổng client theo pool_size: chạy nhiều backend (local + server) cùng lúc thì đặt nhỏ.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),

  // Store (Redis hoặc Dragonfly)
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  // Địa chỉ nghe của cả 3 WebSocket server. Đứng sau reverse proxy cùng máy → '127.0.0.1'
  // (cổng 3001/3002/3003 không lộ ra internet, chỉ proxy TLS mới vào được).
  WS_BIND_HOST: z.string().default('0.0.0.0'),

  // WebSocket: microservice publisher -> app
  TASK_WS_PORT: z.coerce.number().int().default(3001),
  TASK_WS_TOKEN: z.string().min(16),
  // Frame tối đa từ node (MB): snapshot / trang danh sách trận có thể lớn
  TASK_WS_MAX_PAYLOAD_MB: z.coerce.number().positive().default(64),

  // WebSocket: app -> consumer (Discord bot, auto-trade)
  CONSUMER_WS_PORT: z.coerce.number().int().default(3002),
  CONSUMER_WS_TOKEN: z.string().min(16),

  // Khóa chủ mã hóa private key các ví polymarket (một khóa cho mọi ví). Trống = không lưu được key.
  // Tạo: openssl rand -base64 48. Đổi/mất khóa = phải nhập lại mọi private key.
  TRADING_SECRET_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(32).optional(),
  ),

  // Xác thực API: "token:principalId:role1|role2,token2:id2:role" (rỗng = không ai gọi được API)
  API_TOKENS: z.string().default(''),
  // Ghi đè/bổ sung vai trò → quyền, JSON: {"moderator":["team-aliases:*"]}
  ROLE_PERMISSIONS: z.string().optional(),

  // WebSocket: dashboard admin (xác thực bằng token trong API_TOKENS, cần quyền admin:read)
  ADMIN_WS_PORT: z.coerce.number().int().default(3003),
  // Discord webhook nhận cảnh báo vận hành. Để trống = chỉ ghi log.
  DISCORD_ALERT_WEBHOOK_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().optional(),
  ),
  // OneSignal: báo về điện thoại khi có kèo mới ở On click. Trống = tắt.
  // App ID (công khai, giống NEXT_PUBLIC_ONESIGNAL_APP_ID của web) + REST API Key (BÍ MẬT).
  ONESIGNAL_APP_ID: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  ONESIGNAL_REST_API_KEY: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.string().min(1).optional(),
  ),
  // Gốc web Arb Ops (vd https://arbops.vercel.app): bấm thông báo mở trang On click. Trống = không gắn link.
  WEB_APP_URL: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.url().optional(),
  ),
  // Số ngày giữ lịch sử chuyển trạng thái odds
  ODDS_TRANSITION_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
  // Số ngày giữ: lịch sử kèo đã kết thúc / sự cố đã đóng / audit
  SIGNAL_HISTORY_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  INCIDENT_RETENTION_DAYS: z.coerce.number().int().min(1).default(180),
  AUDIT_RETENTION_DAYS: z.coerce.number().int().min(1).default(365),

  // Xóa sạch room trong Redis lúc khởi động (bảng định tuyến trong RAM đã mất → dòng cũ thành mồ côi)
  RESET_ROOMS_ON_START: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  // Quá startsAt + ngần này giờ thì coi trận đã kết thúc → gỡ dòng kèo (match_expired)
  MATCH_MAX_DURATION_HOURS: z.coerce.number().positive().default(8),
});

export type Env = z.infer<typeof envSchema>;

/** Env của microservice task-runner: không cần DB, chỉ cần biết đường về app. */
export const taskRunnerEnvSchema = z.object({
  TASK_RUNNER_NODE_ID: z.string().min(1),
  TASK_RUNNER_APP_URL: z.string().default('ws://127.0.0.1:3001'),
  TASK_WS_TOKEN: z.string().min(16),
});

export type TaskRunnerEnv = z.infer<typeof taskRunnerEnvSchema>;
