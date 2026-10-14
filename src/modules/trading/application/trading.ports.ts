import type { StakeTier } from '../domain/stake-plan.js';
import type { TradingAccount } from '../domain/trading-account.js';
import type { TraderProfile } from '../domain/trader-profile.js';
import type { TradingSettings } from '../domain/trading-settings.js';
import type {
  TradeAttempt,
  TradeAttemptQuery,
  TradeStats,
} from './trade-attempt.js';
import type { TraderRuntimeConfig } from './trader-config.js';

export interface TradingAccountRepository {
  list(): Promise<TradingAccount[]>;
  get(id: string): Promise<TradingAccount | null>;
  save(a: TradingAccount): Promise<void>;
  delete(id: string): Promise<boolean>;
}
export const TRADING_ACCOUNT_REPOSITORY = Symbol('TRADING_ACCOUNT_REPOSITORY');

export interface TraderProfileRepository {
  list(): Promise<TraderProfile[]>;
  get(id: string): Promise<TraderProfile | null>;
  save(p: TraderProfile): Promise<void>;
  delete(id: string): Promise<boolean>;
}
export const TRADER_PROFILE_REPOSITORY = Symbol('TRADER_PROFILE_REPOSITORY');

export interface TradeAttemptRepository {
  /** Trùng id (worker gửi lại) = bỏ qua. */
  record(t: TradeAttempt): Promise<void>;
  get(id: string): Promise<TradeAttempt | null>;
  list(q: TradeAttemptQuery): Promise<TradeAttempt[]>;
  stats(q: { profileId?: string; since?: number }): Promise<TradeStats>;
}
export const TRADE_ATTEMPT_REPOSITORY = Symbol('TRADE_ATTEMPT_REPOSITORY');

export interface TradingSettingsStore {
  get(): Promise<TradingSettings>;
  save(s: TradingSettings): Promise<void>;
}
export const TRADING_SETTINGS_STORE = Symbol('TRADING_SETTINGS_STORE');

/** Mã hóa bí mật (private key ví) bằng khóa chủ. Không có khóa chủ → available() = false. */
export interface SecretCipher {
  available(): boolean;
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}
export const SECRET_CIPHER = Symbol('SECRET_CIPHER');

/** Hạng kèo do admin đặt (dùng chung với kênh thông báo). */
export interface StakeTierSource {
  listTiers(): Promise<StakeTier[]>;
}
export const STAKE_TIER_SOURCE = Symbol('STAKE_TIER_SOURCE');

/** Một task trader đang chạy. */
export interface RunningTrader {
  readonly taskId: string;
  readonly profileId: string;
}

/** Cổng tới các task trader (worker thread / node từ xa). */
export interface TraderTaskGateway {
  listRunning(): Promise<RunningTrader[]>;
  /** Gửi cấu hình đã tính sẵn cho task. false = task không nhận (đã dừng, timeout...). */
  push(taskId: string, config: TraderRuntimeConfig): Promise<boolean>;
}
export const TRADER_TASK_GATEWAY = Symbol('TRADER_TASK_GATEWAY');
