/** Kiểu dữ liệu của module auto trade (backend /trading/*). */
import type { SignalTier } from './types';

export type TradingVenue = 'csgoempire' | 'polymarket';

export type TradingAccountConfig =
  | { venue: 'csgoempire'; browserProfile: string }
  | { venue: 'polymarket'; walletAddress: string; funderAddress: string | null };

export interface TradingAccountView {
  id: string;
  venue: TradingVenue;
  label: string;
  enabled: boolean;
  config: TradingAccountConfig;
  /** Đã lưu private key (mã hóa) hay chưa. Key không bao giờ được trả về. */
  hasSecret: boolean;
  usedBy: string[];
}

export type StakeTrend = 'flat' | 'up' | 'down' | 'custom';

export interface TierStakeOverride {
  stake?: number;
  minStake?: number;
  maxStake?: number;
}

export interface StakePlan {
  trend: StakeTrend;
  baseStake: number;
  stepPct: number;
  minStakeRatio: number;
  maxStakeRatio: number;
  scaleWithinTier: boolean;
  overrides: Record<string, TierStakeOverride>;
}

export const DEFAULT_STAKE_PLAN: StakePlan = {
  trend: 'flat',
  baseStake: 50,
  stepPct: 0.5,
  minStakeRatio: 0.5,
  maxStakeRatio: 1,
  scaleWithinTier: false,
  overrides: {},
};

export interface StakeRow {
  tierId: string;
  tierName: string;
  minMargin: number;
  maxMargin: number | null;
  stake: number;
  minStake: number;
  maxStake: number;
  scaleWithinTier: boolean;
}

export interface StakePreview {
  tiers: SignalTier[];
  rows: StakeRow[];
}

export interface RiskLimits {
  minNetMargin: number;
  matchCapUsd: number;
  maxSignalAgeMs: number;
  /** Vào lại cùng cửa sau (ms); 0 = mỗi cửa chỉ vào một lần mỗi trận. */
  reentryCooldownMs: number;
}

export const DEFAULT_RISK: RiskLimits = { minNetMargin: 0.01, matchCapUsd: 0, maxSignalAgeMs: 3_000, reentryCooldownMs: 0 };

export interface TraderProfile {
  id: string;
  name: string;
  enabled: boolean;
  mode: 'paper';
  csgoempireAccountId: string;
  polymarketAccountId: string;
  stakePlan: StakePlan;
  strategy: { id: string; params: Record<string, unknown> };
  risk: RiskLimits;
}

export interface TraderRuntimeConfig {
  profileId: string;
  active: boolean;
  inactiveReason: string | null;
  stakeTable: StakeRow[];
  matchExposureCapUsd: number;
}

export interface TradingSettings {
  matchExposureCapUsd: number;
  secretKeyConfigured: boolean;
}

export type TradeStatus = 'paper_filled' | 'skipped' | 'cancelled' | 'error';

export interface TradeLeg {
  tenant: string;
  side: number;
  pick: string;
  odds: number;
  /** Trang trận trên sàn. */
  url?: string | null;
}

/** Một mức giá của sổ lệnh Polymarket lúc quyết định. */
export interface DepthLevel {
  price: number;
  size: number;
  usd: number;
  netMargin: number;
  ok: boolean;
}

/** Phần `detail` worker ghi (các trường có thể thiếu tùy kết quả). */
export interface TradeDetail {
  signalAgeMs?: number;
  targetStake?: number | null;
  bestAsk?: number | null;
  budget?: number | null;
  fee?: { enabled: boolean; rate: number; exponent: number };
  limitedBy?: 'stake' | 'depth' | 'budget';
  levels?: { price: number; shares: number; fee: number }[];
  depth?: {
    levels: DepthLevel[];
    maxPrice: number | null;
    sharesAtEdge: number;
    usdAtEdge: number;
    targetShares: number;
    maxStakeAtEdge: number;
  };
  sizing?: { targetStake: number; minStake: number; minShares: number; minNetMargin: number };
  cancelledAfterMs?: number;
  bookAt?: number | null;
}

export interface TradeAttempt {
  id: string;
  profileId: string;
  mode: string;
  signalId: string;
  room: string;
  sport: string;
  market: string;
  teams: [string, string];
  phase: string;
  comboId: string;
  status: TradeStatus;
  reason: string | null;
  signalMargin: number;
  tierName: string | null;
  book: (TradeLeg & { stake: number }) | null;
  polymarket: (TradeLeg & { tokenId: string; shares: number; avgPrice: number; fee: number; cost: number }) | null;
  totalCost: number;
  payout: number;
  profit: number;
  netMargin: number;
  latencyMs: number;
  detail: Record<string, unknown>;
  createdAt: number;
  csgoempireAccountId: string | null;
  polymarketAccountId: string | null;
  /** Mốc thời gian (ms epoch): kèo phát → worker nhận → đọc xong sổ lệnh → quyết định. */
  timing: { signalIssuedAt: number; receivedAt: number; marketDataAt: number | null; decidedAt: number } | null;
  legs: TradeLegRecord[];
}

/** Một chân lệnh. Giấy: status = simulated. */
export interface TradeLegRecord {
  venue: string;
  accountId: string | null;
  side: number;
  pick: string;
  signalPrice: number;
  requestedPrice: number;
  requestedAmount: number;
  filledAmount: number;
  avgPrice: number;
  fee: number;
  cost: number;
  status: string;
  marketRef: string | null;
  orderRef: string | null;
  sentAt: number | null;
  ackedAt: number | null;
  filledAt: number | null;
  error: string | null;
}

export interface TradeStats {
  attempts: number;
  filled: number;
  skipped: number;
  cancelled: number;
  errors: number;
  totalCost: number;
  profit: number;
  skipReasons: Record<string, number>;
}

/** Kind task trader (danh mục task backend). */
export const TRADER_KIND = 'trader.arbitrage';
