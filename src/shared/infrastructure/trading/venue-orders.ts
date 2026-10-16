import {
  createSecureClient,
  AssetType,
  OrderSide,
  OrderType,
  OrderPostStatus,
} from '@polymarket/client';
import { fetchBalanceAllowance } from '@polymarket/client/actions';
import { privateKey } from '@polymarket/client/viem';
import type { LiveTradingConfig } from '../../application/live-trading.js';
import { AesGcmSecretCipher } from './secret-cipher.js';
import { SESSION_EXPIRED } from './empire-session.js';

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
  const blocked =
    response.headers.get('cf-mitigated') === 'challenge' ||
    (!response.ok &&
      /text\/html/i.test(response.headers.get('content-type') ?? ''));
  if (blocked)
    throw new Error(`CSGOEMPIRE_CLOUDFLARE_BLOCKED: HTTP ${response.status}`);
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

/** Đọc tài khoản + Cash csgoempire từ chính cookie của phiên sẽ vào lệnh. */
export async function readEmpireBalance(
  c: Pick<LiveTradingConfig['empire'], 'cookie' | 'userAgent'>,
  signal: AbortSignal,
): Promise<VenueBalance & { username: string | null; email: string | null }> {
  // Cùng User-Agent với Chrome đã nhận cookie: Cloudflare gắn cookie chống bot với trình duyệt đó.
  const browserLike = {
    Accept: 'application/json',
    Referer: 'https://csgoempire.com/',
    ...(c.userAgent ? { 'User-Agent': c.userAgent } : {}),
  };
  const [user, rates] = await Promise.all([
    json(
      'https://csgoempire.com/api/v2/user',
      { headers: { ...browserLike, Cookie: c.cookie } },
      signal,
    ),
    json(
      'https://csgoempire.com/api/v2/metadata/exchange-rates',
      { headers: browserLike },
      signal,
    ),
  ]);
  if (user.success !== true) throw new Error(SESSION_EXPIRED);
  if (user.default_balance_type !== 1)
    throw new Error('CSGOEMPIRE_BALANCE_TYPE_UNSUPPORTED');
  // HAR: user.balance is hundredths of coins; rates share a common base currency.
  const fx = rates.rates as Record<string, unknown> | undefined;
  const coinsRate = finite(fx?.CSGOEMPIRE_COIN);
  if (!coinsRate) throw new Error('CASH_UNAVAILABLE');
  const cash = ((finite(user.balance) / 100) * finite(fx?.USD)) / coinsRate;
  const username = text(user.username);
  return {
    cash,
    account: {
      id: text(user.id),
      name: text(user.steam_name) ?? username,
      wallet: null,
    },
    username,
    email: text(user.email),
  };
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
  return client;
}

async function polymarketCash(
  client: Awaited<ReturnType<typeof polymarketClient>>,
  c: LiveTradingConfig['polymarket'],
) {
  const cashBalance = await fetchBalanceAllowance(client, {
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
): Promise<VenueBalance & { allowance: number }> {
  signal.throwIfAborted();
  return polymarketCash(await polymarketClient(c), c);
}

/** No portfolio valuation, positions, or mark-to-market values enter these checks. */
export class ApiVenueOrders implements VenueOrders {
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
    const { cash, account } = await readEmpireBalance(c, signal);
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
        if (accepted?.bet_id)
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
