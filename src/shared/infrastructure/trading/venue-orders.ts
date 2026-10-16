import {
  createSecureClient,
  AssetType,
  OrderSide,
  OrderType,
  OrderPostStatus,
  SignerType,
} from '@polymarket/client';
import {
  fetchBalanceAllowance,
  fetchPortfolioValue,
  updateBalanceAllowance,
} from '@polymarket/client/actions';
import { privateKey } from '@polymarket/client/viem';
import type { LiveTradingConfig } from '../../application/live-trading.js';
import { AesGcmSecretCipher } from './secret-cipher.js';
import { SESSION_EXPIRED } from './empire-session.js';
import { accountResource, type EmpireBalanceRead } from './account-lock.js';

export interface OrderPlan {
  id: string;
  bookRef: Readonly<Record<string, string>>;
  bookSide: number;
  bookOdds: number;
  stake: number;
  tokenId: string;
  shares: number;
  polyLimit: number;
  polyFee: number;
  expiresAt: number;
}
export interface VenueFill {
  status: 'filled' | 'partial' | 'accepted' | 'rejected' | 'error';
  orderRef: string | null;
  filledAmount: number;
  avgPrice: number;
  fee: number;
  cost: number;
  sentAt: number;
  ackedAt: number;
  filledAt: number | null;
  error: string | null;
}
/** Tài khoản thật mà sàn trả về (đọc từ chính phiên/ví dùng để vào lệnh). */
export interface VenueAccountIdentity {
  /** csgoempire: user id; polymarket: địa chỉ ví ký lệnh (signer). */
  id: string | null;
  /** csgoempire: tên Steam / username; polymarket: null. */
  name: string | null;
  /** polymarket: ví giữ tiền (funder hoặc chính ví ký). */
  wallet: string | null;
}
export interface VenueBalance {
  account: VenueAccountIdentity;
  /** Cash dùng được (USD). */
  cash: number;
}
export interface PreparedOrder {
  cash: number;
  requiredCash: number;
  account: VenueAccountIdentity;
  submit(): Promise<VenueFill>;
}
export interface VenueOrders {
  empire(
    config: LiveTradingConfig['empire'],
    plan: OrderPlan,
    signal: AbortSignal,
  ): Promise<PreparedOrder>;
  polymarket(
    config: LiveTradingConfig['polymarket'],
    plan: OrderPlan,
    signal: AbortSignal,
  ): Promise<PreparedOrder>;
}

async function json(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
): Promise<Record<string, unknown>> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
    redirect: 'error',
  });
  // Cloudflare chặn (trang chống bot, không phải API trả lời): KHÔNG phải phiên hết hạn,
  // nên không được khóa tài khoản như phiên hết hạn.
  if (response.headers.get('cf-mitigated') === 'challenge')
    throw new Error(`CSGOEMPIRE_CLOUDFLARE_BLOCKED: HTTP ${response.status}`);
  // Lỗi trả trang HTML (không phải API trả lời): sàn từ chối endpoint, không phải phiên hết hạn.
  if (
    !response.ok &&
    /text\/html/i.test(response.headers.get('content-type') ?? '')
  )
    throw new Error(`CSGOEMPIRE_HTTP_REJECTED: HTTP ${response.status}`);
  if (response.status === 401 || response.status === 403)
    throw new Error(SESSION_EXPIRED);
  if (!response.ok) throw new Error(`VENUE_HTTP_${response.status}`);
  try {
    return (await response.json()) as Record<string, unknown>;
  } catch {
    throw new Error(`VENUE_NOT_JSON: HTTP ${response.status}`);
  }
}
function finite(value: unknown): number {
  const n =
    typeof value === 'string' || typeof value === 'number'
      ? Number(value)
      : NaN;
  if (!Number.isFinite(n) || n < 0) throw new Error('CASH_UNAVAILABLE');
  return n;
}

const insufficientCash = (
  cash: number,
  requiredCash: number,
  account: VenueAccountIdentity,
): PreparedOrder => ({
  cash,
  requiredCash,
  account,
  submit: () => Promise.reject(new Error('INSUFFICIENT_CASH')),
});

const text = (v: unknown): string | null =>
  typeof v === 'string' && v.trim()
    ? v.trim()
    : typeof v === 'number' && Number.isFinite(v)
      ? String(v)
      : null;

/**
 * Tính số dư từ phản hồi /api/v2/metadata + /api/v2/metadata/exchange-rates mà CHROME đã đọc
 * (csgoempire từ chối các request API không đến từ trình duyệt thật, kể cả có cookie).
 */
export function empireBalanceFrom(
  meta: unknown,
  rates: unknown,
): VenueBalance & {
  coins: number;
  username: string | null;
  email: string | null;
} {
  const user = (meta as { user?: unknown } | null)?.user as
    Record<string, unknown> | null | undefined;
  // khách (chưa đăng nhập) → không có user
  if (!user || typeof user !== 'object') throw new Error(SESSION_EXPIRED);
  if (user.default_balance_type !== 1)
    throw new Error('CSGOEMPIRE_BALANCE_TYPE_UNSUPPORTED');
  const coins = empireCoins(user);
  const fx = (rates as { rates?: Record<string, unknown> } | null)?.rates;
  const coinsRate = finite(fx?.CSGOEMPIRE_COIN);
  if (!coinsRate) throw new Error('CASH_UNAVAILABLE');
  // rates cùng một đơn vị gốc: coin → USD. Làm tròn XUỐNG tới cent như csgoempire hiển thị
  // (không bao giờ báo dư hơn số tiền thật; +1e-9 bù sai số dấu phẩy động khi đúng tròn cent).
  const cash =
    Math.floor(((coins * finite(fx?.USD)) / coinsRate) * 100 + 1e-9) / 100;
  const username = text(user.username);
  return {
    cash,
    coins,
    account: {
      id: text(user.id),
      name: text(user.steam_name) ?? username,
      wallet: null,
    },
    username,
    email: text(user.email),
  };
}

/** Kho số dư csgoempire do Chrome nền ghi (Redis) — worker chỉ đọc ở đây, không gọi csgoempire. */
export interface EmpireBalanceStore {
  readEmpireBalance(resource: string): Promise<EmpireBalanceRead>;
  spendEmpire(resource: string, amount: number): Promise<void>;
}
/** Số dư đọc cách đây quá chừng này thì không dùng để vào lệnh. */
export const EMPIRE_BALANCE_MAX_AGE_MS = 60_000;

/**
 * Số coin hiện có. `user.balance` là phần trăm coin (HAR gốc); `balances[].balance_coins` là coin.
 * Có cả hai thì PHẢI khớp (lệch ≤ 1%), không thì từ chối thay vì đoán đơn vị → không tính sai tiền.
 */
export function empireCoins(user: Record<string, unknown>): number {
  const fromCents = finite(user.balance) / 100;
  const list = Array.isArray(user.balances)
    ? (user.balances as Record<string, unknown>[])
    : [];
  const entry =
    list.find((b) => b.balance_type === user.default_balance_type) ?? list[0];
  const raw = entry?.balance_coins;
  if (raw === undefined || raw === null || raw === '') return fromCents;
  const coins = finite(raw);
  const scale = Math.max(Math.abs(coins), Math.abs(fromCents), 1e-9);
  if (Math.abs(coins - fromCents) / scale > 0.01)
    throw new Error(
      'CASH_UNAVAILABLE: số coin và balance của csgoempire không khớp đơn vị',
    );
  return coins;
}

async function polymarketClient(c: LiveTradingConfig['polymarket']) {
  const signer = privateKey(
    new AesGcmSecretCipher(process.env.TRADING_SECRET_KEY).decrypt(
      c.secretCipher,
    ),
  );
  const client = await createSecureClient({
    signer,
    wallet: c.funderAddress ?? c.walletAddress,
  });
  if (client.account.signer.toLowerCase() !== c.walletAddress.toLowerCase())
    throw new Error('POLYMARKET_WALLET_MISMATCH');
  // Ví funder phải là ví Polymarket (proxy / safe / deposit wallet) SINH RA từ chính private key này.
  // Không khớp thì thư viện coi key là "session key" của một deposit wallet → sàn báo "no deposit
  // wallet found for owner". Báo rõ thay vì để lỗi đó lọt ra.
  if (c.funderAddress && client.account.signerType !== SignerType.OWNER)
    throw new Error(
      'POLYMARKET_FUNDER_MISMATCH: ví funder không phải ví Polymarket của private key này',
    );
  return client;
}

async function polymarketCash(
  client: Awaited<ReturnType<typeof polymarketClient>>,
  c: LiveTradingConfig['polymarket'],
  refresh = false,
) {
  // CLOB lưu đệm số dư: tiền vừa nạp / vừa khớp có thể chưa hiện (vd Polymarket 0.08$ mà CLOB báo 0).
  // `refresh` bắt CLOB đọc lại số dư on-chain trước khi trả.
  const read = refresh ? updateBalanceAllowance : fetchBalanceAllowance;
  const cashBalance = await read(client, {
    assetType: AssetType.COLLATERAL,
  });
  // COLLATERAL is spendable cash in base units, never portfolio value.
  const cash = finite(cashBalance.balance) / 1e6;
  const allowance = Math.max(
    0,
    ...Object.values(cashBalance.allowances).map((a) => Number(a) / 1e6),
  );
  const account: VenueAccountIdentity = {
    id: client.account.signer,
    name: null,
    wallet: c.funderAddress ?? c.walletAddress,
  };
  return { cash, allowance, account };
}

/** Đọc ví + Cash Polymarket bằng đúng private key sẽ ký lệnh. */
export async function readPolymarketBalance(
  c: LiveTradingConfig['polymarket'],
  signal: AbortSignal,
): Promise<VenueBalance & { allowance: number; positions: number | null }> {
  signal.throwIfAborted();
  const client = await polymarketClient(c);
  const [balance, positions] = await Promise.all([
    polymarketCash(client, c, true),
    // Giá trị vị thế đang mở: CHỈ để hiển thị, không bao giờ dùng để tính tiền vào lệnh.
    fetchPortfolioValue(client, { user: client.account.wallet })
      .then((v) => {
        const n = Number(v.value);
        return Number.isFinite(n) ? n : null;
      })
      .catch(() => null),
  ]);
  return { ...balance, positions };
}

/** No portfolio valuation, positions, or mark-to-market values enter these checks. */
export class ApiVenueOrders implements VenueOrders {
  constructor(private readonly empireBalances?: EmpireBalanceStore) {}

  /** Số dư còn dùng được = số Chrome nền đọc gần nhất − tiền bot đã cược sau lần đọc đó. */
  private async empireCash(browserProfile: string) {
    if (!this.empireBalances)
      throw new Error('CSGOEMPIRE_BALANCE_UNAVAILABLE: chưa có kho số dư');
    const resource = accountResource('csgoempire', browserProfile);
    const { snapshot, lastError, spent } =
      await this.empireBalances.readEmpireBalance(resource);
    const age = snapshot ? Date.now() - snapshot.at : Infinity;
    if (!snapshot || age > EMPIRE_BALANCE_MAX_AGE_MS) {
      const why = lastError
        ? `lần đọc gần nhất lỗi ${lastError.error}`
        : snapshot
          ? `đọc cách đây ${Math.round(age / 1000)} giây`
          : 'Chrome nền chưa đọc được lần nào';
      throw new Error(`CSGOEMPIRE_BALANCE_UNAVAILABLE: ${why}`);
    }
    // Lần đọc/kiểm tra tài khoản GẦN NHẤT lỗi (sau số dư đang có): không tin số dư cũ, từ chối vào lệnh
    // cho tới khi Chrome nền đọc lại thành công.
    if (lastError && lastError.at >= snapshot.at)
      throw new Error(
        `CSGOEMPIRE_BALANCE_UNAVAILABLE: lần đọc gần nhất lỗi ${lastError.error}`,
      );
    return {
      resource,
      at: snapshot.at,
      cash: Math.max(0, snapshot.cash - spent),
      account: { ...snapshot.account, wallet: null },
    };
  }

  async empire(
    c: LiveTradingConfig['empire'],
    p: OrderPlan,
    signal: AbortSignal,
  ): Promise<PreparedOrder> {
    if (c.expiresAt <= Date.now() + 20_000) throw new Error(SESSION_EXPIRED);
    if (!p.bookRef.e || !p.bookRef.m || !p.bookRef[`o${p.bookSide}`])
      throw new Error('CSGOEMPIRE_REF_MISSING');
    if (Math.abs(p.stake * 100 - Math.round(p.stake * 100)) > 1e-6)
      throw new Error(
        'CSGOEMPIRE_STAKE_PRECISION: cần số tiền chính xác đến cent',
      );
    if (p.stake < c.minBet) throw new Error('CSGOEMPIRE_BELOW_MIN_BET');
    const headers = {
      Authorization: `Bearer ${c.token}`,
      'Content-Type': 'application/json',
      'X-Session-Id': c.sessionId,
      Origin: 'https://csgoempire.com',
    };
    const coupon = {
      type: '1/1',
      sum: p.stake.toFixed(2),
      k: String(p.bookOdds),
      global_id: null,
      bonus_id: null,
      bet_request_id: p.id,
      odds_change: 'higher',
      selections: [
        {
          event_id: p.bookRef.e,
          market_id: p.bookRef.m,
          specifiers: p.bookRef.s ?? '',
          outcome_id: p.bookRef[`o${p.bookSide}`],
          k: String(p.bookOdds),
          source: {
            layout: 'tile',
            page: '/:sportSlug/:categorySlug/:tournamentSlug/:eventSlugAndId',
            section: '',
            extra: { market: 'Main', timeFilter: '', banner_type: '', tab: '' },
          },
          promo_id: null,
          bonus_id: null,
          timestamp: Date.now(),
        },
      ],
    };
    signal.throwIfAborted();
    const { cash, account, resource } = await this.empireCash(c.browserProfile);
    if (cash < p.stake) return insufficientCash(cash, p.stake, account);
    const limit = await json(
      `${c.apiUrl}/api/v1/coupon/max`,
      { method: 'POST', headers, body: JSON.stringify(coupon) },
      signal,
    );
    if (finite(limit.max_bet) < p.stake)
      throw new Error('CSGOEMPIRE_BET_LIMIT');
    return {
      cash,
      requiredCash: p.stake,
      account,
      submit: async () => {
        const sentAt = Date.now();
        const result = await json(
          `${c.apiUrl}/api/v2/coupon/brand/${c.brandId}/bet/place`,
          { method: 'POST', headers, body: JSON.stringify([coupon]) },
          new AbortController().signal,
        );
        const ackedAt = Date.now();
        const accepted = Array.isArray(result.accepted)
          ? (result.accepted.find(
              (v: { bet_request_id?: string }) => v.bet_request_id === p.id,
            ) as { bet_id?: string } | undefined)
          : undefined;
        if (accepted?.bet_id) {
          // trừ ngay vào số dư đã đọc, để lệnh kế tiếp không dùng lại cùng số tiền
          await this.empireBalances
            ?.spendEmpire(resource, p.stake)
            .catch(() => undefined);
          return {
            status: 'filled',
            orderRef: accepted.bet_id,
            filledAmount: p.stake,
            avgPrice: p.bookOdds,
            fee: 0,
            cost: p.stake,
            sentAt,
            ackedAt,
            filledAt: ackedAt,
            error: null,
          };
        }
        if (Array.isArray(result.error) && result.error.length)
          return {
            status: 'rejected',
            orderRef: null,
            filledAmount: 0,
            avgPrice: 0,
            fee: 0,
            cost: 0,
            sentAt,
            ackedAt,
            filledAt: null,
            error: 'CSGOEMPIRE_ORDER_REJECTED',
          };
        throw new Error('CSGOEMPIRE_ORDER_UNKNOWN');
      },
    };
  }

  async polymarket(
    c: LiveTradingConfig['polymarket'],
    p: OrderPlan,
    signal: AbortSignal,
  ): Promise<PreparedOrder> {
    signal.throwIfAborted();
    const client = await polymarketClient(c);
    const { cash, allowance, account } = await polymarketCash(client, c);
    const requiredCash =
      Math.ceil((p.shares * p.polyLimit + p.polyFee) * 1e6) / 1e6;
    if (cash < requiredCash)
      return insufficientCash(cash, requiredCash, account);
    if (cash >= requiredCash && allowance < requiredCash)
      throw new Error('POLYMARKET_ALLOWANCE_INSUFFICIENT');
    const signed = await client.createLimitOrder({
      assetId: p.tokenId,
      side: OrderSide.BUY,
      price: p.polyLimit,
      size: p.shares,
    });
    // orderType is submission policy, outside the signed EIP-712 order fields.
    const order = { ...signed, orderType: OrderType.FOK };
    const signedShares = Number(order.takerAmount) / 1e6;
    if (Math.abs(signedShares - p.shares) > 1e-6)
      throw new Error('POLYMARKET_SIZE_PRECISION');
    signal.throwIfAborted();
    return {
      cash,
      requiredCash,
      account,
      submit: async () => {
        const sentAt = Date.now();
        const response = await client.postOrder(order);
        const ackedAt = Date.now();
        if (!response.ok)
          return {
            status: 'rejected',
            orderRef: null,
            filledAmount: 0,
            avgPrice: 0,
            fee: 0,
            cost: 0,
            sentAt,
            ackedAt,
            filledAt: null,
            error: `POLYMARKET_REJECTED:${response.code}`,
          };
        const filledAmount = finite(response.takingAmount);
        const notional = finite(response.makingAmount);
        const fee = p.polyFee;
        let status: VenueFill['status'] =
          response.status === OrderPostStatus.MATCHED &&
          filledAmount >= p.shares - 1e-6
            ? 'filled'
            : filledAmount > 0
              ? 'partial'
              : 'accepted';
        if (status === 'filled') {
          try {
            await client.waitForOrderFillSettlement(response, {
              timeoutMs: 20_000,
            });
          } catch {
            status = 'partial';
          }
        }
        return {
          status,
          orderRef: response.orderId,
          filledAmount,
          avgPrice: filledAmount > 0 ? notional / filledAmount : 0,
          fee,
          cost: notional + (filledAmount > 0 ? fee : 0),
          sentAt,
          ackedAt,
          filledAt: status === 'filled' ? Date.now() : null,
          error: status === 'filled' ? null : 'POLYMARKET_FILL_UNCONFIRMED',
        };
      },
    };
  }
}
