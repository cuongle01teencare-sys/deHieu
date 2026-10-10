import { z } from 'zod';

export const envSchema = z.object({
  DATABASE_URL: z.url(),

  // Store (Redis hoặc Dragonfly)
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),

  // WebSocket: microservice publisher -> app
  TASK_WS_PORT: z.coerce.number().int().default(3001),
  TASK_WS_TOKEN: z.string().min(16),

  // WebSocket: app -> consumer (Discord bot, auto-trade)
  CONSUMER_WS_PORT: z.coerce.number().int().default(3002),
  CONSUMER_WS_TOKEN: z.string().min(16),

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
  // Số ngày giữ lịch sử chuyển trạng thái odds
  ODDS_TRANSITION_RETENTION_DAYS: z.coerce.number().int().min(1).default(7),
});

export type Env = z.infer<typeof envSchema>;

/** Env của microservice task-runner: không cần DB, chỉ cần biết đường về app. */
export const taskRunnerEnvSchema = z.object({
  TASK_RUNNER_NODE_ID: z.string().min(1),
  TASK_RUNNER_APP_URL: z.string().default('ws://127.0.0.1:3001'),
  TASK_WS_TOKEN: z.string().min(16),
});

export type TaskRunnerEnv = z.infer<typeof taskRunnerEnvSchema>;
