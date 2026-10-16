import type { StakeTier } from '../domain/stake-plan.js';
import type { TradingAccount } from '../domain/trading-account.js';
import type { TraderProfile } from '../domain/trader-profile.js';
import type { TradingSettings } from '../domain/trading-settings.js';
import type {
  TradeAttempt,
  TradeAttemptQuery,
  TradePurgeFilter,
  TradeStats,
  TradeStatsQuery,
} from './trade-attempt.js';
import type { TraderRuntimeConfig } from './trader-config.js';
import type {
  EmpireLoginStatus,
  EmpireJwtPreview,
} from '../../../shared/application/empire-login.js';

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
  stats(q: TradeStatsQuery): Promise<TradeStats>;
  /** Số lệnh khớp phạm vi xóa. */
  count(f: TradePurgeFilter): Promise<number>;
  /** Xóa lệnh (kèm các chân) khớp phạm vi; trả số lệnh đã xóa. */
  purge(f: TradePurgeFilter): Promise<number>;
  /** Xóa một lệnh (kèm các chân). false = không có. */
  delete(id: string): Promise<boolean>;
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
  /** Lệnh điều khiển khác (vd 'reset_seen'). false = task không nhận. */
  command(taskId: string, name: string, data?: unknown): Promise<boolean>;
}
export const TRADER_TASK_GATEWAY = Symbol('TRADER_TASK_GATEWAY');
export const EMPIRE_BROWSER_GATEWAY = Symbol('EMPIRE_BROWSER_GATEWAY');
export interface EmpireBrowserGateway {
  startLogin(account: TradingAccount): EmpireLoginStatus;
  loginStatus(browserProfile: string): EmpireLoginStatus | null;
  cancelLogin(browserProfile: string): Promise<EmpireLoginStatus | null>;
  takeJwtPreview(
    browserProfile: string,
    attemptId: string,
  ): EmpireJwtPreview | null;
}

/** Kết quả đọc tài khoản thật + Cash trực tiếp từ sàn (dùng đúng phiên/khóa bot vào lệnh). */
export interface TradingAccountCheck {
  readonly accountId: string;
  readonly venue: 'csgoempire' | 'polymarket';
  readonly label: string;
  /** csgoempire: user id; polymarket: ví ký lệnh. */
  readonly remoteId: string | null;
  /** csgoempire: tên Steam / username trên sàn. */
  readonly remoteName: string | null;
  /** polymarket: ví giữ tiền (funder hoặc ví ký). */
  readonly wallet: string | null;
  /** Cash dùng được (USD). */
  readonly cash: number;
  /** polymarket: allowance USDC cho sàn. */
  readonly allowance: number | null;
  /**
   * polymarket: giá trị vị thế đang mở (USD) — chỉ hiển thị; Portfolio = cash + positions.
   * null = sàn không trả / không áp dụng (csgoempire).
   */
  readonly positions: number | null;
  /**
   * Khớp với cấu hình đã lưu? csgoempire: tài khoản đăng nhập trên sàn = email/username đã lưu;
   * polymarket: private key ký ra đúng địa chỉ ví đã lưu. null = không đủ dữ liệu để so.
   */
  readonly matchesConfig: boolean | null;
  readonly checkedAt: number;
}

export const TRADING_ACCOUNT_CHECKER = Symbol('TRADING_ACCOUNT_CHECKER');
export interface TradingAccountChecker {
  /** Ném lỗi có mã (vd CSGOEMPIRE_SESSION_EXPIRED) khi không đọc được. */
  check(account: TradingAccount): Promise<TradingAccountCheck>;
}

/** Infrastructure prepares private worker credentials and live account readiness. */
export interface TraderExecutionConfigProvider {
  prepare(
    config: TraderRuntimeConfig,
    accounts: readonly TradingAccount[],
  ): Promise<TraderRuntimeConfig>;
}
