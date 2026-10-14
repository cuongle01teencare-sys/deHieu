import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
};

/** Tài khoản giao dịch (csgoempire / polymarket). Bí mật lưu mã hóa, không bao giờ trả ra API. */
export const drizzleTradingAccountsTable = pgTable('trading_accounts', {
  id: text('id').primaryKey(),
  venue: text('venue').notNull(),
  label: text('label').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  /** Cấu hình theo nền tảng (browserProfile / walletAddress, funderAddress). */
  config: jsonb('config').$type<Record<string, unknown>>().notNull(),
  /** AES-256-GCM bằng TRADING_SECRET_KEY: "v1:iv:tag:data" (base64). */
  secretCipher: text('secret_cipher'),
  ...timestamps,
});

/** Trader: cặp tài khoản + kế hoạch vốn + chiến lược + giới hạn rủi ro. */
export const drizzleTraderProfilesTable = pgTable('trader_profiles', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  enabled: boolean('enabled').default(true).notNull(),
  mode: text('mode').notNull(),
  csgoempireAccountId: text('csgoempire_account_id').notNull(),
  polymarketAccountId: text('polymarket_account_id').notNull(),
  stakePlan: jsonb('stake_plan').$type<Record<string, unknown>>().notNull(),
  strategy: jsonb('strategy').$type<Record<string, unknown>>().notNull(),
  risk: jsonb('risk').$type<Record<string, unknown>>().notNull(),
  ...timestamps,
});

/** Mỗi lần trader xử lý một kèo (giấy hoặc thật). */
export const drizzleTradeAttemptsTable = pgTable(
  'trade_attempts',
  {
    id: text('id').primaryKey(),
    profileId: text('profile_id').notNull(),
    mode: text('mode').notNull(),
    signalId: text('signal_id').notNull(),
    room: text('room').notNull(),
    sport: text('sport').notNull(),
    market: text('market').notNull(),
    teams: jsonb('teams').$type<[string, string]>().notNull(),
    phase: text('phase').notNull(),
    comboId: text('combo_id').notNull(),
    status: text('status').notNull(),
    reason: text('reason'),
    signalMargin: doublePrecision('signal_margin').notNull(),
    tierName: text('tier_name'),
    book: jsonb('book').$type<Record<string, unknown> | null>(),
    polymarket: jsonb('polymarket').$type<Record<string, unknown> | null>(),
    totalCost: doublePrecision('total_cost').notNull(),
    payout: doublePrecision('payout').notNull(),
    profit: doublePrecision('profit').notNull(),
    netMargin: doublePrecision('net_margin').notNull(),
    latencyMs: doublePrecision('latency_ms').notNull(),
    detail: jsonb('detail').$type<Record<string, unknown>>().notNull(),
    csgoempireAccountId: text('csgoempire_account_id'),
    polymarketAccountId: text('polymarket_account_id'),
    /** Mốc thời gian: kèo phát → worker nhận → đọc xong sổ lệnh → quyết định. */
    signalIssuedAt: timestamp('signal_issued_at', { withTimezone: true }),
    receivedAt: timestamp('received_at', { withTimezone: true }),
    marketDataAt: timestamp('market_data_at', { withTimezone: true }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('trade_attempts_profile_created_idx').on(t.profileId, t.createdAt),
    index('trade_attempts_created_idx').on(t.createdAt),
    index('trade_attempts_signal_idx').on(t.signalId),
  ],
);

/**
 * Từng chân của lệnh (csgoempire / polymarket). Giấy: status = simulated, khớp giả định.
 * Thật (sau này): giá yêu cầu ↔ giá khớp, mã lệnh, phản hồi thô và các mốc gửi/nhận/khớp để đo độ trễ.
 */
export const drizzleTradeLegsTable = pgTable(
  'trade_legs',
  {
    id: text('id').primaryKey(), // <attemptId>:<venue>
    attemptId: text('attempt_id').notNull(),
    profileId: text('profile_id').notNull(),
    mode: text('mode').notNull(),
    venue: text('venue').notNull(),
    accountId: text('account_id'),
    side: integer('side').notNull(),
    pick: text('pick').notNull(),
    signalPrice: doublePrecision('signal_price').notNull(),
    requestedPrice: doublePrecision('requested_price').notNull(),
    requestedAmount: doublePrecision('requested_amount').notNull(),
    filledAmount: doublePrecision('filled_amount').notNull(),
    avgPrice: doublePrecision('avg_price').notNull(),
    fee: doublePrecision('fee').notNull(),
    cost: doublePrecision('cost').notNull(),
    status: text('status').notNull(),
    marketRef: text('market_ref'),
    orderRef: text('order_ref'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    ackedAt: timestamp('acked_at', { withTimezone: true }),
    filledAt: timestamp('filled_at', { withTimezone: true }),
    error: text('error'),
    raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    index('trade_legs_attempt_idx').on(t.attemptId),
    index('trade_legs_venue_created_idx').on(t.venue, t.createdAt),
    index('trade_legs_account_created_idx').on(t.accountId, t.createdAt),
  ],
);

/** Cấu hình chung của auto trade, key → JSON (tách khỏi app_settings của module odds). */
export const drizzleTradingSettingsTable = pgTable('trading_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .defaultNow()
    .notNull()
    .$onUpdate(() => new Date()),
});
