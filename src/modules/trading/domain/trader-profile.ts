import { validateStakePlan, type StakePlan } from './stake-plan.js';

/** Chế độ chạy. Hiện chỉ có giấy (paper): đọc sổ lệnh thật, ghi lãi/lỗ giả định, không đặt lệnh. */
export const TRADER_MODES = ['paper'] as const;
export type TraderMode = (typeof TRADER_MODES)[number];

/**
 * Chiến lược: id + tham số tự do. Worker giữ danh mục chiến lược theo id
 * (thêm chiến lược mới, kể cả mô hình ML, = thêm một id, không sửa profile).
 */
export interface StrategyRef {
  readonly id: string;
  readonly params: Readonly<Record<string, unknown>>;
}

export const DEFAULT_STRATEGY: StrategyRef = { id: 'arb-taker', params: {} };

export interface RiskLimits {
  /** Lợi nhuận ròng tối thiểu SAU phí và trượt giá thật của sổ lệnh, vd 0.01 = 1%. */
  readonly minNetMargin: number;
  /** Tổng tiền tối đa của RIÊNG profile này vào một trận (USD, cả hai chân); 0 = không giới hạn riêng. */
  readonly matchCapUsd: number;
  /** Bỏ qua kèo đã phát quá lâu (ms) khi tới worker; 0 = không kiểm tra. */
  readonly maxSignalAgeMs: number;
  /**
   * Số lệnh tối đa cho MỘT cửa (room + tổ hợp sàn/phía) ở MỖI hạng kèo. Mỗi hạng tính riêng:
   * cùng cửa lên từ Phổ thông → VIP → sVIP thì mỗi hạng vào được tới số này, dù margin lên hay xuống.
   */
  readonly maxEntriesPerTier: number;
  /**
   * Lý do hủy kèo mà trader KHÔNG dừng lệnh đang tính (vd 'better_opportunity': publisher hủy kèo cũ
   * để phát kèo tốt hơn — kèo cũ vẫn còn lãi nên cứ vào). Lý do khác → dừng.
   */
  readonly ignoreCancelReasons: readonly string[];
  /**
   * Market profile được vào (vd 'game-winner', 'map-handicap-p1.5'). null = mọi market
   * (kể cả market thêm sau); [] = chưa chọn market nào → profile đứng yên.
   */
  readonly markets: readonly string[] | null;
  /**
   * Giá bán thấp nhất Polymarket ≥ số này (vd 0.5) → bot KHÔNG tự vào, chuyển kèo sang On click
   * cho người vào lệnh. 0 = tắt (bot vào mọi kèo).
   */
  readonly oneClickMinPrice: number;
}

export const DEFAULT_RISK_LIMITS: RiskLimits = {
  minNetMargin: 0.01,
  matchCapUsd: 0,
  maxSignalAgeMs: 3_000,
  maxEntriesPerTier: 1,
  ignoreCancelReasons: ['better_opportunity'],
  markets: null,
  oneClickMinPrice: 0.5,
};

/** Profile có vào market này không. */
export const marketSelected = (r: RiskLimits, market: string): boolean =>
  r.markets === null || r.markets.includes(market);

/** Một "trader": 1 tài khoản csgoempire + 1 tài khoản polymarket + kế hoạch vốn + chiến lược + giới hạn rủi ro. */
export interface TraderProfile {
  readonly id: string;
  readonly name: string;
  readonly enabled: boolean;
  readonly mode: TraderMode;
  readonly csgoempireAccountId: string;
  readonly polymarketAccountId: string;
  readonly stakePlan: StakePlan;
  readonly strategy: StrategyRef;
  readonly risk: RiskLimits;
}

export function validateRiskLimits(r: RiskLimits): string | null {
  if (!(r.minNetMargin >= 0 && r.minNetMargin < 1))
    return 'minNetMargin phải trong [0, 1)';
  if (!(r.matchCapUsd >= 0)) return 'matchCapUsd phải ≥ 0 (0 = không giới hạn)';
  if (!(r.maxSignalAgeMs >= 0)) return 'maxSignalAgeMs phải ≥ 0';
  if (!(Number.isInteger(r.maxEntriesPerTier) && r.maxEntriesPerTier >= 1))
    return 'maxEntriesPerTier phải là số nguyên ≥ 1';
  if (!(r.oneClickMinPrice >= 0 && r.oneClickMinPrice <= 1))
    return 'oneClickMinPrice phải trong [0, 1] (0 = tắt)';
  if (r.markets !== null && r.markets.length > 100)
    return 'markets tối đa 100 market';
  return null;
}

/** Lỗi nội tại của profile (không kiểm tra tài khoản có tồn tại — việc của use case). */
export function validateTraderProfile(p: TraderProfile): string | null {
  if (!p.name.trim()) return 'PROFILE_NAME_REQUIRED';
  if (!p.strategy.id.trim()) return 'STRATEGY_REQUIRED';
  const plan = validateStakePlan(p.stakePlan);
  if (plan) return `STAKE_PLAN_INVALID: ${plan}`;
  const risk = validateRiskLimits(p.risk);
  if (risk) return `RISK_INVALID: ${risk}`;
  return null;
}
