import { randomUUID } from 'node:crypto';
import type { OperationStatus } from '../../../shared/domain/domain-repository.js';
import type { StakeRow } from '../../../shared/domain/stake-table.js';
import {
  resolveStakeTable,
  sortTiers,
  validateStakePlan,
  type StakePlan,
  type StakeTier,
} from '../domain/stake-plan.js';
import {
  normalizePrivateKey,
  validateAccountConfig,
  type TradingAccount,
  type TradingAccountConfig,
  type TradingVenue,
} from '../domain/trading-account.js';
import {
  validateTraderProfile,
  type RiskLimits,
  type StrategyRef,
  type TraderMode,
  type TraderProfile,
} from '../domain/trader-profile.js';
import {
  validateTradingSettings,
  type TradingSettings,
} from '../domain/trading-settings.js';
import type {
  TradeAttempt,
  TradeAttemptQuery,
  TradePurgeFilter,
  TradePurgeResult,
  TradeStats,
  TradeStatus,
} from './trade-attempt.js';
import type { TraderConfigSync } from './trader-config.sync.js';
import type { TraderRuntimeConfig } from './trader-config.js';
import type {
  SecretCipher,
  StakeTierSource,
  TradeAttemptRepository,
  TraderProfileRepository,
  TradingAccountRepository,
  TradingSettingsStore,
} from './trading.ports.js';

export interface AccountInput {
  readonly label: string;
  readonly enabled: boolean;
  readonly config: TradingAccountConfig;
  /** polymarket: private key. Bỏ trống khi sửa = giữ key cũ. */
  readonly privateKey?: string;
}

/** Tài khoản trả cho web: KHÔNG kèm bí mật, chỉ cho biết đã có hay chưa. */
export interface TradingAccountView {
  readonly id: string;
  readonly venue: TradingVenue;
  readonly label: string;
  readonly enabled: boolean;
  readonly config: TradingAccountConfig;
  readonly hasSecret: boolean;
  /** Profile đang dùng tài khoản này. */
  readonly usedBy: readonly string[];
}

export interface ProfileInput {
  readonly name: string;
  readonly enabled: boolean;
  readonly mode: TraderMode;
  readonly csgoempireAccountId: string;
  readonly polymarketAccountId: string;
  readonly stakePlan: StakePlan;
  readonly strategy: StrategyRef;
  readonly risk: RiskLimits;
}

/** Yêu cầu xóa lệnh: chọn trạng thái (một hoặc nhiều) HOẶC all = true. */
export interface TradePurgeInput {
  readonly statuses?: readonly TradeStatus[];
  /** Xóa mọi trạng thái (vẫn áp profileId/before nếu có). */
  readonly all?: boolean;
  readonly profileId?: string;
  readonly before?: number;
  /** Chỉ đếm, không xóa. */
  readonly dryRun?: boolean;
}

export interface StakePreview {
  readonly tiers: readonly StakeTier[];
  readonly rows: readonly StakeRow[];
}

const fail = (reason: string) => ({ status: 'FAILED' as const, reason });

/**
 * Use case quản trị auto trade: tài khoản, profile, cấu hình chung, xem lệnh giấy.
 * Mọi thay đổi ghi database rồi gửi lại cấu hình cho các task trader đang chạy.
 */
export class TradingAdmin {
  constructor(
    private readonly _accounts: TradingAccountRepository,
    private readonly _profiles: TraderProfileRepository,
    private readonly _trades: TradeAttemptRepository,
    private readonly _settings: TradingSettingsStore,
    private readonly _tiers: StakeTierSource,
    private readonly _cipher: SecretCipher,
    private readonly _sync: TraderConfigSync,
  ) {}

  // ------------------------------------------------------------- tài khoản

  async listAccounts(): Promise<TradingAccountView[]> {
    const [accounts, profiles] = await Promise.all([
      this._accounts.list(),
      this._profiles.list(),
    ]);
    return accounts.map((a) => this._view(a, profiles));
  }

  async saveAccount(
    id: string | null,
    input: AccountInput,
  ): Promise<OperationStatus<TradingAccountView>> {
    const label = input.label.trim();
    if (!label) return fail('ACCOUNT_LABEL_REQUIRED');
    const invalid = validateAccountConfig(input.config);
    if (invalid) return fail(invalid);
    const all = await this._accounts.list();
    const old = id ? all.find((a) => a.id === id) : undefined;
    if (id && !old) return { status: 'NOT_FOUND' };
    if (old && old.config.venue !== input.config.venue)
      return fail('VENUE_IMMUTABLE: không đổi được nền tảng của tài khoản');
    if (
      all.some(
        (a) =>
          a.id !== id &&
          a.config.venue === input.config.venue &&
          a.label.toLowerCase() === label.toLowerCase(),
      )
    )
      return fail(`ACCOUNT_LABEL_TAKEN: đã có tài khoản "${label}"`);

    let secretCipher = old?.secretCipher ?? null;
    const rawKey = input.privateKey?.trim();
    if (rawKey) {
      if (input.config.venue !== 'polymarket')
        return fail('SECRET_NOT_ALLOWED: chỉ ví polymarket lưu private key');
      const key = normalizePrivateKey(rawKey);
      if (!key) return fail('PRIVATE_KEY_INVALID: 64 ký tự hex (có/không 0x)');
      if (!this._cipher.available())
        return fail(
          'SECRET_KEY_MISSING: chưa đặt TRADING_SECRET_KEY trong .env nên không lưu được private key',
        );
      secretCipher = this._cipher.encrypt(key);
    }

    const account: TradingAccount = {
      id: id ?? randomUUID(),
      label,
      enabled: input.enabled,
      config: input.config,
      secretCipher,
    };
    await this._accounts.save(account);
    await this._sync.pushAll();
    return {
      status: 'SUCEED',
      data: this._view(account, await this._profiles.list()),
    };
  }

  async deleteAccount(id: string): Promise<OperationStatus<true>> {
    const users = (await this._profiles.list()).filter(
      (p) => p.csgoempireAccountId === id || p.polymarketAccountId === id,
    );
    if (users.length)
      return fail(
        `ACCOUNT_IN_USE: đang dùng ở profile ${users.map((p) => `"${p.name}"`).join(', ')}`,
      );
    if (!(await this._accounts.delete(id))) return { status: 'NOT_FOUND' };
    return { status: 'SUCEED', data: true };
  }

  // ------------------------------------------------------------- profile

  listProfiles(): Promise<TraderProfile[]> {
    return this._profiles.list();
  }

  async getProfile(id: string): Promise<OperationStatus<TraderProfile>> {
    const p = await this._profiles.get(id);
    return p ? { status: 'SUCEED', data: p } : { status: 'NOT_FOUND' };
  }

  async saveProfile(
    id: string | null,
    input: ProfileInput,
  ): Promise<OperationStatus<TraderProfile>> {
    const profile: TraderProfile = {
      id: id ?? randomUUID(),
      ...input,
      name: input.name.trim(),
    };
    const invalid = validateTraderProfile(profile);
    if (invalid) return fail(invalid);
    const [all, accounts] = await Promise.all([
      this._profiles.list(),
      this._accounts.list(),
    ]);
    if (id && !all.some((p) => p.id === id)) return { status: 'NOT_FOUND' };
    if (
      all.some(
        (p) =>
          p.id !== profile.id &&
          p.name.toLowerCase() === profile.name.toLowerCase(),
      )
    )
      return fail(`PROFILE_NAME_TAKEN: đã có profile "${profile.name}"`);
    const venueOf = (accId: string) =>
      accounts.find((a) => a.id === accId)?.config.venue;
    if (venueOf(profile.csgoempireAccountId) !== 'csgoempire')
      return fail('CSGOEMPIRE_ACCOUNT_INVALID: chọn một tài khoản csgoempire');
    if (venueOf(profile.polymarketAccountId) !== 'polymarket')
      return fail('POLYMARKET_ACCOUNT_INVALID: chọn một tài khoản polymarket');
    const tiers = new Set((await this._tiers.listTiers()).map((t) => t.id));
    const unknown = Object.keys(profile.stakePlan.overrides).filter(
      (t) => !tiers.has(t),
    );
    // hạng đã bị xóa ở module odds: bỏ ghi đè mồ côi thay vì báo lỗi
    const clean: TraderProfile = unknown.length
      ? {
          ...profile,
          stakePlan: {
            ...profile.stakePlan,
            overrides: Object.fromEntries(
              Object.entries(profile.stakePlan.overrides).filter(([t]) =>
                tiers.has(t),
              ),
            ),
          },
        }
      : profile;
    await this._profiles.save(clean);
    await this._sync.pushAll();
    return { status: 'SUCEED', data: clean };
  }

  async deleteProfile(id: string): Promise<OperationStatus<true>> {
    if (!(await this._profiles.delete(id))) return { status: 'NOT_FOUND' };
    await this._sync.pushAll();
    return { status: 'SUCEED', data: true };
  }

  /** Cấu hình worker sẽ nhận cho profile (xem trước / gỡ lỗi). */
  runtimeConfig(profileId: string): Promise<TraderRuntimeConfig> {
    return this._sync.configFor(profileId);
  }

  // ------------------------------------------------------------- bảng vốn

  async previewStakeTable(
    plan: StakePlan,
  ): Promise<OperationStatus<StakePreview>> {
    const invalid = validateStakePlan(plan);
    if (invalid) return fail(`STAKE_PLAN_INVALID: ${invalid}`);
    const tiers = sortTiers(await this._tiers.listTiers());
    return {
      status: 'SUCEED',
      data: { tiers, rows: resolveStakeTable(plan, tiers) },
    };
  }

  // ------------------------------------------------------------- cấu hình chung

  getSettings(): Promise<TradingSettings> {
    return this._settings.get();
  }

  async saveSettings(
    s: TradingSettings,
  ): Promise<OperationStatus<TradingSettings>> {
    const invalid = validateTradingSettings(s);
    if (invalid) return fail(invalid);
    await this._settings.save(s);
    await this._sync.pushAll();
    return { status: 'SUCEED', data: s };
  }

  secretKeyConfigured(): boolean {
    return this._cipher.available();
  }

  // ------------------------------------------------------------- lệnh

  listTrades(q: TradeAttemptQuery): Promise<TradeAttempt[]> {
    return this._trades.list(q);
  }

  async getTrade(id: string): Promise<OperationStatus<TradeAttempt>> {
    const t = await this._trades.get(id);
    return t ? { status: 'SUCEED', data: t } : { status: 'NOT_FOUND' };
  }

  tradeStats(q: { profileId?: string; since?: number }): Promise<TradeStats> {
    return this._trades.stats(q);
  }

  /**
   * Xóa lệnh theo trạng thái (kết hợp nhiều trạng thái), theo profile/thời điểm, hoặc toàn bộ.
   * Bắt buộc chọn rõ trạng thái hoặc all = true để không lỡ tay xóa sạch.
   * Lưu ý: không trả lại hạn mức theo trận đã giữ trong sổ phơi nhiễm (tự hết hạn theo TTL).
   */
  async purgeTrades(
    input: TradePurgeInput,
  ): Promise<OperationStatus<TradePurgeResult>> {
    const statuses = [...new Set(input.statuses ?? [])];
    if (input.all && statuses.length)
      return fail(
        'TRADE_PURGE_SCOPE_CONFLICT: chọn statuses hoặc all, không chọn cả hai',
      );
    if (!input.all && !statuses.length)
      return fail(
        'TRADE_PURGE_SCOPE_REQUIRED: chọn ít nhất một trạng thái hoặc all = true',
      );
    const filter: TradePurgeFilter = {
      ...(statuses.length ? { statuses } : {}),
      ...(input.profileId ? { profileId: input.profileId } : {}),
      ...(input.before ? { before: input.before } : {}),
    };
    const matched = await this._trades.count(filter);
    if (input.dryRun || !matched)
      return { status: 'SUCEED', data: { matched, deleted: 0 } };
    const deleted = await this._trades.purge(filter);
    return { status: 'SUCEED', data: { matched, deleted } };
  }

  async deleteTrade(id: string): Promise<OperationStatus<true>> {
    return (await this._trades.delete(id))
      ? { status: 'SUCEED', data: true }
      : { status: 'NOT_FOUND' };
  }

  private _view(
    a: TradingAccount,
    profiles: readonly TraderProfile[],
  ): TradingAccountView {
    return {
      id: a.id,
      venue: a.config.venue,
      label: a.label,
      enabled: a.enabled,
      config: a.config,
      hasSecret: a.secretCipher !== null,
      usedBy: profiles
        .filter(
          (p) =>
            p.csgoempireAccountId === a.id || p.polymarketAccountId === a.id,
        )
        .map((p) => p.name),
    };
  }
}
