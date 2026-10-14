import 'server-only';
import type { BackendResponse } from './backend';
import type { SignalTier } from './types';
import {
  DEFAULT_RISK,
  DEFAULT_STAKE_PLAN,
  type StakePlan,
  type StakeRow,
  type TradeAttempt,
  type TradeStats,
  type TradingAccountView,
  type TraderProfile,
} from './trading-types';

/** Dữ liệu mẫu cho trang Auto trade (chế độ mẫu, không có backend). */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Cùng công thức với backend (domain/stake-plan). */
function resolveStakeTable(plan: StakePlan, tiers: SignalTier[]): StakeRow[] {
  return [...tiers]
    .sort((a, b) => a.minMargin - b.minMargin || a.name.localeCompare(b.name))
    .map((t, i) => {
      const o = plan.overrides[t.id] ?? {};
      const f = 1 + plan.stepPct;
      const auto = plan.trend === 'up' ? plan.baseStake * f ** i : plan.trend === 'down' ? plan.baseStake / f ** i : plan.baseStake;
      const stake = round2(plan.trend === 'custom' ? (o.stake ?? 0) : auto);
      const minStake = round2(o.minStake ?? stake * plan.minStakeRatio);
      const maxStake = round2(Math.max(stake, o.maxStake ?? stake * plan.maxStakeRatio));
      return { tierId: t.id, tierName: t.name, minMargin: t.minMargin, maxMargin: t.maxMargin, stake, minStake: Math.min(minStake, stake), maxStake, scaleWithinTier: plan.scaleWithinTier };
    });
}

let accounts: TradingAccountView[] = [
  { id: 'acc-empire-1', venue: 'csgoempire', label: 'Empire #1', enabled: true, config: { venue: 'csgoempire', browserProfile: 'empire-1' }, hasSecret: false, usedBy: [] },
  { id: 'acc-empire-2', venue: 'csgoempire', label: 'Empire #2', enabled: false, config: { venue: 'csgoempire', browserProfile: 'empire-2' }, hasSecret: false, usedBy: [] },
  {
    id: 'acc-poly-1',
    venue: 'polymarket',
    label: 'Poly #1',
    enabled: true,
    config: { venue: 'polymarket', walletAddress: '0x8f3a5b1c2d4e6f708192a3b4c5d6e7f8091a2b3c', funderAddress: null },
    hasSecret: true,
    usedBy: [],
  },
];

let profiles: TraderProfile[] = [
  {
    id: 'prof-a',
    name: 'Trader A',
    enabled: true,
    mode: 'paper',
    csgoempireAccountId: 'acc-empire-1',
    polymarketAccountId: 'acc-poly-1',
    stakePlan: { ...DEFAULT_STAKE_PLAN, trend: 'up', baseStake: 40, stepPct: 0.5, maxStakeRatio: 1.5, scaleWithinTier: true },
    strategy: { id: 'arb-taker', params: {} },
    risk: { ...DEFAULT_RISK },
  },
];

let matchExposureCapUsd = 500;

const MATCHES: [string, [string, string], string][] = [
  ['lol', ['t1', 'gen.g'], 'match-winner'],
  ['cs2', ['vitality', 'mouz'], 'map-1-winner'],
  ['dota2', ['team spirit', 'tundra'], 'match-winner'],
  ['valorant', ['fnatic', 'sentinels'], 'match-winner'],
  ['cs2', ['navi', 'faze'], 'match-winner'],
];
const SKIPS = ['NO_EDGE: giá tốt nhất 0.47 → lãi 0.62% < 1.00%', 'INSUFFICIENT_DEPTH: chỉ vào được 12.40$ < tối thiểu 20$', 'NO_TIER: margin 1.40%', 'CAP_REACHED: giới hạn tổng theo trận vừa bị trader khác dùng hết'];

const trades: TradeAttempt[] = Array.from({ length: 48 }, (_, i) => {
  const [sport, teams, market] = MATCHES[i % MATCHES.length]!;
  const filled = i % 3 !== 1;
  const odds = 1.9 + ((i * 7) % 9) / 20;
  const margin = 0.02 + ((i * 13) % 50) / 1000;
  const stake = filled ? 40 + (i % 4) * 10 : 0;
  const shares = round2(stake * odds);
  const price = round2(1 / odds - margin * 0.6);
  const fee = round2(shares * 0.05 * price * (1 - price));
  const cost = round2(shares * price + fee);
  const total = round2(stake + cost);
  return {
    id: `prof-a:sig-${i}`,
    profileId: 'prof-a',
    mode: 'paper',
    signalId: `sig-${i}`,
    room: `room:${sport}:${teams.join('~')}:${market}`,
    sport,
    market,
    teams,
    phase: i % 2 ? 'live' : 'prematch',
    comboId: 'sptpub>0|polymarket>1',
    status: i === 7 ? 'cancelled' : filled ? 'paper_filled' : 'skipped',
    reason: i === 7 ? 'SIGNAL_CANCELLED: margin_decreased' : filled ? null : SKIPS[i % SKIPS.length]!,
    signalMargin: margin,
    tierName: margin >= 0.05 ? 'VIP' : 'Thường',
    book: { tenant: 'sptpub', side: 0, pick: teams[0], odds, stake, url: 'https://csgoempire.com/match-betting' },
    polymarket: { tenant: 'polymarket', side: 1, pick: teams[1], odds: round2(1 / price), tokenId: `tok-${i}`, shares, avgPrice: price, fee, cost, url: `https://polymarket.com/event/${sport}-${teams.join('-').replace(/[^a-z0-9-]/g, '')}` },
    totalCost: filled ? total : 0,
    payout: filled ? shares : 0,
    profit: filled ? round2(shares - total) : 0,
    netMargin: filled ? (shares - total) / total : 0,
    latencyMs: 80 + ((i * 37) % 200),
    detail: (() => {
      const lv = [price, round2(price + 0.01), round2(price + 0.02), round2(price + 0.04)].map((p, k) => {
        const size = [filled ? shares * 0.7 : 12, filled ? shares * 0.5 : 8, 40, 300][k]!;
        const f = 0.05 * p * (1 - p);
        const nm = 1 / (1 / odds + p + f) - 1;
        return { price: p, size: round2(size), usd: round2(size * (p + f)), netMargin: nm, ok: nm >= 0.01 };
      });
      const edge = lv.filter((l) => l.ok);
      const sh = edge.reduce((a, l) => a + l.size, 0);
      return {
        signalAgeMs: 6,
        targetStake: 50,
        bestAsk: price,
        fee: { enabled: true, rate: 0.05, exponent: 1 },
        limitedBy: 'stake',
        levels: filled ? [{ price, shares: round2(shares * 0.7), fee }, { price: round2(price + 0.01), shares: round2(shares * 0.3), fee: 0 }] : [],
        depth: { levels: lv, maxPrice: edge.at(-1)?.price ?? null, sharesAtEdge: round2(sh), usdAtEdge: round2(edge.reduce((a, l) => a + l.usd, 0)), targetShares: round2(50 * odds), maxStakeAtEdge: round2(sh / odds) },
        sizing: { targetStake: 50, minStake: 25, minShares: 5, minNetMargin: 0.01 },
        bookAt: Date.now() - i * 23 * 60_000,
        ...(i === 7 ? { cancelledAfterMs: 84 } : {}),
      };
    })(),
    createdAt: Date.now() - i * 23 * 60_000,
    csgoempireAccountId: 'acc-empire-1',
    polymarketAccountId: 'acc-poly-1',
    timing: (() => {
      const at = Date.now() - i * 23 * 60_000;
      const sent = at - 150 - ((i * 31) % 120);
      return { signalIssuedAt: sent, receivedAt: sent + 4 + (i % 9), marketDataAt: at - 20, decidedAt: at - 12 };
    })(),
    legs: [],
  } satisfies TradeAttempt;
});

const withUse = (a: TradingAccountView): TradingAccountView => ({
  ...a,
  usedBy: profiles.filter((p) => p.csgoempireAccountId === a.id || p.polymarketAccountId === a.id).map((p) => p.name),
});

/** null = không phải đường dẫn trading. */
export function mockTrading(method: string, path: string, search: string, body: unknown, tiers: () => SignalTier[]): BackendResponse | null {
  if (!path.startsWith('trading/')) return null;
  const ok = (b: unknown, status = 200) => ({ status, body: b });
  const bad = (message: string) => ({ status: 400, body: { message } });
  const q = new URLSearchParams(search);
  const p = path.slice('trading/'.length);
  const b = (body ?? {}) as Record<string, unknown>;

  if (method === 'GET') {
    if (p === 'accounts') return ok(accounts.map(withUse));
    if (p === 'profiles') return ok(profiles);
    if (p === 'settings') return ok({ matchExposureCapUsd, secretKeyConfigured: true });
    const rc = /^profiles\/(.+)\/runtime-config$/.exec(p);
    if (rc) {
      const prof = profiles.find((x) => x.id === decodeURIComponent(rc[1]!));
      const stakeTable = prof ? resolveStakeTable(prof.stakePlan, tiers()) : [];
      return ok({ profileId: rc[1], active: !!prof?.enabled, inactiveReason: prof ? (prof.enabled ? null : 'PROFILE_DISABLED') : 'PROFILE_NOT_FOUND', stakeTable, matchExposureCapUsd });
    }
    const filtered = () =>
      trades
        .filter((t) => !q.get('profileId') || t.profileId === q.get('profileId'))
        .filter((t) => !q.get('status') || t.status === q.get('status'));
    if (p === 'trades') {
      const before = Number(q.get('before') ?? Infinity);
      return ok(filtered().filter((t) => t.createdAt < before).slice(0, Number(q.get('limit') ?? 100)));
    }
    if (p === 'trades/stats') {
      const since = Number(q.get('since') ?? 0);
      const list = filtered().filter((t) => t.createdAt >= since);
      const s: TradeStats = { attempts: list.length, filled: 0, skipped: 0, cancelled: 0, errors: 0, totalCost: 0, profit: 0, skipReasons: {} };
      for (const t of list) {
        if (t.status === 'paper_filled') {
          s.filled++;
          s.totalCost += t.totalCost;
          s.profit += t.profit;
        } else if (t.status === 'skipped') {
          s.skipped++;
          const code = (t.reason ?? '').split(':')[0]!;
          s.skipReasons[code] = (s.skipReasons[code] ?? 0) + 1;
        } else if (t.status === 'cancelled') s.cancelled++;
        else s.errors++;
      }
      return ok(s);
    }
    const one = /^profiles\/([^/]+)$/.exec(p);
    if (one) {
      const prof = profiles.find((x) => x.id === decodeURIComponent(one[1]!));
      return prof ? ok(prof) : { status: 404, body: { message: 'Not Found' } };
    }
  }

  if (method === 'POST' && p === 'stake-preview') {
    const plan = { ...DEFAULT_STAKE_PLAN, ...(b as Partial<StakePlan>) };
    const sorted = [...tiers()].sort((x, y) => x.minMargin - y.minMargin);
    return ok({ tiers: sorted, rows: resolveStakeTable(plan, sorted) }, 201);
  }

  const accountId = /^accounts\/([^/]+)$/.exec(p)?.[1];
  if ((method === 'POST' && p === 'accounts') || (method === 'PUT' && accountId)) {
    const label = String(b.label ?? '').trim();
    if (!label) return bad('ACCOUNT_LABEL_REQUIRED');
    const old = accounts.find((a) => a.id === accountId);
    const config = b.config as TradingAccountView['config'];
    const next: TradingAccountView = {
      id: old?.id ?? `acc-${Date.now().toString(36)}`,
      venue: config.venue,
      label,
      enabled: b.enabled !== false,
      config,
      hasSecret: !!old?.hasSecret || (typeof b.privateKey === 'string' && b.privateKey.length > 0),
      usedBy: [],
    };
    accounts = old ? accounts.map((a) => (a.id === old.id ? next : a)) : [...accounts, next];
    return ok(withUse(next), old ? 200 : 201);
  }
  if (method === 'DELETE' && accountId) {
    if (withUse(accounts.find((a) => a.id === accountId) ?? accounts[0]!).usedBy.length) return bad('ACCOUNT_IN_USE');
    accounts = accounts.filter((a) => a.id !== accountId);
    return ok(true);
  }

  const profileId = /^profiles\/([^/]+)$/.exec(p)?.[1];
  if ((method === 'POST' && p === 'profiles') || (method === 'PUT' && profileId)) {
    const old = profiles.find((x) => x.id === profileId);
    const next = { ...(b as unknown as TraderProfile), id: old?.id ?? `prof-${Date.now().toString(36)}`, mode: 'paper' as const };
    profiles = old ? profiles.map((x) => (x.id === old.id ? next : x)) : [...profiles, next];
    return ok(next, old ? 200 : 201);
  }
  if (method === 'DELETE' && profileId) {
    profiles = profiles.filter((x) => x.id !== profileId);
    return ok(true);
  }
  if (method === 'PUT' && p === 'settings') {
    matchExposureCapUsd = Number(b.matchExposureCapUsd ?? 0);
    return ok({ matchExposureCapUsd });
  }
  return { status: 404, body: { message: 'Not Found' } };
}
