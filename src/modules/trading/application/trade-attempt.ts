import { z } from 'zod';

/** Kết quả một lần trader xử lý kèo. */
export const TRADE_STATUSES = [
  'filled', // hai chân thật đã nhận/khớp
  'partial', // lệch vị thế hoặc có chân chưa rõ kết quả; cần đối soát
  'paper_filled', // giấy: đủ điều kiện, ghi lãi/lỗ giả định theo sổ lệnh thật
  'skipped', // không vào lệnh (lý do ở reason)
  'cancelled', // kèo bị hủy khi đang xử lý
  'error',
] as const;
export type TradeStatus = (typeof TRADE_STATUSES)[number];

const num = z.number().finite();
const leg = z.object({
  tenant: z.string(),
  side: z.number().int(),
  pick: z.string(),
  odds: num,
  /** Trang trận trên sàn (để mở kiểm tra). */
  url: z.string().nullable().default(null),
  /** Giờ bắt đầu trận theo sàn này lúc kèo phát (ms). */
  startsAt: num.nullable().default(null),
  /** Trận thứ `no` / `of` trận trong giải `name` theo sàn này (các trận sàn đang liệt kê). */
  tournament: z
    .object({ name: z.string().nullable(), no: num, of: num })
    .nullable()
    .default(null),
});

/** Trạng thái một chân lệnh. Giấy = `simulated`; các trạng thái còn lại dành cho giao dịch thật. */
export const TRADE_LEG_STATUSES = [
  'simulated', // giấy: khớp giả định theo sổ lệnh/odds lúc quyết định
  'pending', // đã gửi, chưa có phản hồi
  'accepted', // sàn nhận lệnh (cược đã đặt / lệnh đã vào sổ)
  'filled', // khớp đủ
  'partial', // khớp một phần
  'rejected', // sàn từ chối (odds đổi, vượt giới hạn...)
  'cancelled',
  'error',
] as const;
export type TradeLegStatus = (typeof TRADE_LEG_STATUSES)[number];

const ts = num.nullable().default(null);

/**
 * Một chân của lệnh (csgoempire hoặc polymarket). Lưu riêng từng chân để sau này so sánh
 * giấy ↔ thật: giá/odds lúc kèo phát → giá yêu cầu → giá khớp thật, và độ trễ từng mốc.
 */
export const TradeLegSchema = z.object({
  venue: z.string(),
  accountId: z.string().nullable(),
  side: z.number().int(),
  pick: z.string(),
  /** Odds (csgoempire) hoặc giá (polymarket) trên kèo lúc phát. */
  signalPrice: num,
  /** Odds/giá giới hạn khi gửi lệnh (polymarket: mức giá xa nhất chấp nhận). */
  requestedPrice: num,
  /** csgoempire: tiền cược (USD); polymarket: số share. */
  requestedAmount: num,
  filledAmount: num,
  /** Odds/giá khớp trung bình. */
  avgPrice: num,
  fee: num,
  /** Tiền thực chi cho chân này (gồm phí). */
  cost: num,
  status: z.enum(TRADE_LEG_STATUSES),
  /** Mã tham chiếu thị trường (token id, event/market/outcome id). */
  marketRef: z.string().nullable().default(null),
  /** Mã lệnh / mã vé cược do sàn trả về (giao dịch thật). */
  orderRef: z.string().nullable().default(null),
  sentAt: ts,
  ackedAt: ts,
  filledAt: ts,
  error: z.string().nullable().default(null),
  /** Phản hồi thô của sàn (giao dịch thật) để phân loại lỗi về sau. */
  raw: z.record(z.string(), z.unknown()).default({}),
});
export type TradeLeg = z.infer<typeof TradeLegSchema>;

/** Các mốc thời gian của một lần xử lý kèo (ms epoch). */
export const TradeTimingSchema = z.object({
  /** Lúc kèo được phát (issuedAt của kèo). */
  signalIssuedAt: num,
  /** Lúc worker nhận kèo. */
  receivedAt: num,
  /** Lúc đọc xong sổ lệnh + thông số market. */
  marketDataAt: ts,
  /** Lúc quyết định xong (vào / bỏ qua). */
  decidedAt: num,
});
export type TradeTiming = z.infer<typeof TradeTimingSchema>;

/**
 * Bản ghi worker gửi về (kênh 'trade'). Đây là hợp đồng với worker: kiểm tra chặt
 * để dữ liệu hỏng không vào database.
 */
export const TradeAttemptSchema = z.object({
  id: z.string().min(1).max(200),
  profileId: z.string().min(1),
  mode: z.string(),
  signalId: z.string(),
  room: z.string(),
  sport: z.string(),
  market: z.string(),
  teams: z.tuple([z.string(), z.string()]),
  phase: z.string(),
  comboId: z.string(),
  status: z.enum(TRADE_STATUSES),
  reason: z.string().nullable(),
  signalMargin: num,
  tierName: z.string().nullable(),
  /** Chân csgoempire (sptpub). */
  book: leg.extend({ stake: num }).nullable(),
  /** Chân polymarket: số share mua, giá trung bình, phí taker, tổng tiền (gồm phí). */
  polymarket: leg
    .extend({
      tokenId: z.string(),
      shares: num,
      avgPrice: num,
      fee: num,
      cost: num,
    })
    .nullable(),
  totalCost: num,
  /** Tiền về nếu một trong hai cửa thắng (đã cân hai chân). */
  payout: num,
  profit: num,
  netMargin: num,
  latencyMs: num,
  detail: z.record(z.string(), z.unknown()).default({}),
  createdAt: num,
  csgoempireAccountId: z.string().nullable().default(null),
  polymarketAccountId: z.string().nullable().default(null),
  timing: TradeTimingSchema.nullable().default(null),
  /** Chân lệnh (chỉ có khi vào lệnh). */
  legs: z.array(TradeLegSchema).default([]),
});
export type TradeAttempt = z.infer<typeof TradeAttemptSchema>;

/** Nguồn lệnh: bot (Auto trade) hoặc người vào tay ở On click (detail.manual). */
export const TRADE_SOURCES = ['bot', 'manual'] as const;
export type TradeSource = (typeof TRADE_SOURCES)[number];

export interface TradeStatsQuery {
  readonly profileId?: string;
  readonly since?: number;
  /** Bỏ trống = gộp cả hai. */
  readonly source?: TradeSource;
}

export interface TradeAttemptQuery {
  readonly profileId?: string;
  readonly status?: TradeStatus;
  readonly source?: TradeSource;
  /** createdAt < before (phân trang lùi). */
  readonly before?: number;
  readonly limit: number;
}

/**
 * Phạm vi xóa lệnh. Các điều kiện kết hợp bằng AND; trong `statuses` là OR
 * (vd. skipped HOẶC error). Không có điều kiện nào = xóa toàn bộ sổ lệnh.
 */
export interface TradePurgeFilter {
  readonly statuses?: readonly TradeStatus[];
  readonly profileId?: string;
  /** Chỉ xóa lệnh có createdAt < before. */
  readonly before?: number;
}

export interface TradePurgeResult {
  /** Số lệnh khớp phạm vi lúc xóa. */
  readonly matched: number;
  /** Số lệnh đã xóa (0 khi dryRun). */
  readonly deleted: number;
  /** Xóa toàn bộ: số task trader đã được báo xét lại kèo còn sống. */
  readonly resetTasks?: number;
}

export interface TradeStats {
  readonly attempts: number;
  readonly filled: number;
  readonly skipped: number;
  readonly cancelled: number;
  readonly errors: number;
  /** Tổng tiền đã (giả định) vào lệnh và lãi giả định của lệnh paper_filled. */
  readonly totalCost: number;
  readonly profit: number;
  /** Lý do bỏ qua → số lần. */
  readonly skipReasons: Readonly<Record<string, number>>;
}
