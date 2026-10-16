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
  type AccountReport,
  type ReportBucket,
  type ReportMode,
  type ReportPeriod,
  type ReportTrade,
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
      return { tierId: t.id, tierName: t.name, minMargin: t.minMargin, maxMargin: t.maxMargin, stake, minStake: Math.min(minStake, stake), maxStake, scaleWithinTier: plan.scaleWithinTier, enabled: plan.tierIds == null || plan.tierIds.includes(t.id), maxEntries: o.maxEntries ?? null };
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
    stakePlan: { ...DEFAULT_STAKE_PLAN, trend: 'up', baseStake: 40, stepPct: 0.5, maxStakeRatio: 1.5, scaleWithinTier: true, tierIds: null },
    strategy: { id: 'arb-taker', params: {} },
    risk: { ...DEFAULT_RISK },
  },
];

let matchExposureCapUsd = 500;
const oneClickTaken = new Set<string>();

const MATCHES: [string, [string, string], string][] = [
  ['lol', ['t1', 'gen.g'], 'match-winner'],
  ['cs2', ['vitality', 'mouz'], 'map-1-winner'],
  ['dota2', ['team spirit', 'tundra'], 'match-winner'],
  ['valorant', ['fnatic', 'sentinels'], 'match-winner'],
  ['cs2', ['navi', 'faze'], 'match-winner'],
];
const SKIPS = ['NO_EDGE: giá tốt nhất 0.47 → lãi 0.62% < 1.00%', 'INSUFFICIENT_DEPTH: chỉ vào được 12.40$ < tối thiểu 20$', 'NO_TIER: margin 1.40%', 'CAP_REACHED: giới hạn tổng theo trận vừa bị trader khác dùng hết'];

let trades: TradeAttempt[] = Array.from({ length: 48 }, (_, i) => {
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
    book: { tenant: 'sptpub', side: 0, pick: teams[0], odds, stake, url: 'https://csgoempire.com/match-betting', tournament: { name: 'iem-cologne', no: 3 + (i % 5), of: 12 } },
    polymarket: { tenant: 'polymarket', side: 1, pick: teams[1], odds: round2(1 / price), tokenId: `tok-${i}`, shares, avgPrice: price, fee, cost, url: `https://polymarket.com/event/${sport}-${teams.join('-').replace(/[^a-z0-9-]/g, '')}`, tournament: { name: 'IEM Cologne', no: 4 + (i % 5), of: 14 } },
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

  const reportId = /^accounts\/([^/]+)\/report$/.exec(p)?.[1];
  if (method === 'GET' && reportId) {
    const acc = accounts.find((a) => a.id === decodeURIComponent(reportId));
    return acc ? ok(mockAccountReport(acc, (q.get('modes') ?? 'live').split(',') as ReportMode[])) : { status: 404, body: { message: 'Not Found' } };
  }
  const checkId = /^accounts\/([^/]+)\/check$/.exec(p)?.[1];
  if (method === 'POST' && checkId) {
    const acc = accounts.find((a) => a.id === decodeURIComponent(checkId));
    if (!acc) return { status: 404, body: { message: 'Not Found' } };
    return ok({
      accountId: acc.id,
      venue: acc.venue,
      label: acc.label,
      remoteId: acc.venue === 'csgoempire' ? '7712039' : acc.config.venue === 'polymarket' ? acc.config.walletAddress : null,
      remoteName: acc.venue === 'csgoempire' ? 'arb_trader_01' : null,
      wallet: acc.config.venue === 'polymarket' ? (acc.config.funderAddress ?? acc.config.walletAddress) : null,
      cash: acc.venue === 'csgoempire' ? 1284.37 : 942.15,
      allowance: acc.venue === 'polymarket' ? 1e9 : null,
      positions: acc.venue === 'polymarket' ? 57.3 : null,
      matchesConfig: true,
      checkedAt: Date.now(),
    });
  }
  if (method === 'POST' && p === 'settlements/run') return ok({ checked: 4, settled: 2 });
  if ((method === 'PUT' || method === 'DELETE') && /^trades\/[^/]+\/settlement$/.test(p)) return ok(true);

  if (method === 'GET') {
    if (p === 'accounts') return ok(accounts.map(withUse));
    if (p === 'profiles') return ok(profiles);
    if (p === 'settings') return ok({ matchExposureCapUsd, secretKeyConfigured: true });
    const rc = /^profiles\/(.+)\/runtime-config$/.exec(p);
    if (rc) {
      const prof = profiles.find((x) => x.id === decodeURIComponent(rc[1]!));
      const stakeTable = prof ? resolveStakeTable(prof.stakePlan, tiers()) : [];
      const inactiveReason = !prof ? 'PROFILE_NOT_FOUND' : !prof.enabled ? 'PROFILE_DISABLED' : prof.stakePlan.tierIds?.length === 0 ? 'NO_TIER_SELECTED' : prof.risk.markets?.length === 0 ? 'NO_MARKET_SELECTED' : null;
      return ok({ profileId: rc[1], active: !inactiveReason, inactiveReason, stakeTable, matchExposureCapUsd });
    }
    const filtered = () =>
      trades
        .filter((t) => !q.get('profileId') || t.profileId === q.get('profileId'))
        .filter((t) => !q.get('status') || t.status === q.get('status'))
        .filter((t) => {
          const src = q.get('source');
          const manual = !!(t.detail as { manual?: unknown }).manual;
          return !src || (src === 'manual' ? manual : !manual);
        });
    if (p === 'trades') {
      const before = Number(q.get('before') ?? Infinity);
      return ok(filtered().filter((t) => t.createdAt < before).slice(0, Number(q.get('limit') ?? 100)));
    }
    if (p === 'push/status') return ok({ configured: true, webUrl: 'https://arbops.example.com' });
    if (p === 'oneclick/history') {
      const now = Date.now();
      const ends: [string | null, string | null][] = [
        [null, null],
        ['manual:paper_filled', 'admin'],
        ['cancelled:margin_decreased', null],
        ['expired', null],
        ['result:paper_filled', null],
        ['result:skipped:NO_EDGE', null],
        ['app_restart', null],
      ];
      const all = trades
        .filter((t) => t.profileId === (q.get('profileId') ?? t.profileId) && t.status === 'paper_filled')
        .slice(0, 14)
        .map((t, k) => {
          const [endReason, enteredBy] = ends[k % ends.length]!;
          const firstAt = now - (k + 1) * 47 * 60_000;
          return {
            profileId: t.profileId,
            signalId: t.signalId,
            room: t.room,
            sport: t.sport,
            market: t.market,
            phase: t.phase,
            comboId: t.comboId,
            teams: t.teams,
            signalMargin: t.signalMargin,
            tierName: t.tierName,
            minAsk: 0.52 + (k % 4) * 0.03,
            threshold: 0.5,
            analysis: { ...t, reason: 'ONE_CLICK: giá bán thấp nhất ≥ 0.5', detail: { ...t.detail, minAsk: 0.52 + (k % 4) * 0.03, oneClickMinPrice: 0.5 } },
            updates: 1 + (k % 3),
            firstAt,
            lastAt: firstAt + 5 * 60_000,
            expiresAt: firstAt + 10 * 60_000,
            endedAt: endReason ? firstAt + 7 * 60_000 : null,
            endReason,
            enteredBy,
          };
        });
      const kind = (e: { endedAt: number | null; endReason: string | null }) =>
        e.endedAt === null ? 'open' : e.endReason?.startsWith('manual:') ? 'manual' : e.endReason?.startsWith('cancelled:') ? 'cancelled' : e.endReason === 'expired' ? 'expired' : e.endReason?.startsWith('result:paper_filled') ? 'auto' : 'other';
      const text = (q.get('q') ?? '').trim().toLowerCase();
      const from = Number(q.get('from') ?? 0);
      const items = all
        .filter((e) => !q.get('outcome') || kind(e) === q.get('outcome'))
        .filter((e) => e.firstAt >= from)
        .filter((e) => !text || e.signalId.toLowerCase().startsWith(text) || e.teams.join(' ').toLowerCase().includes(text));
      const limit = Number(q.get('limit') ?? 50);
      return ok({ total: items.length, items: items.slice(0, limit) });
    }
    if (p === 'oneclick') {
      const pid = q.get('profileId') ?? '';
      const now = Date.now();
      const list = trades
        .filter((t) => t.profileId === pid && t.status === 'paper_filled')
        .slice(0, 3)
        .filter((t) => !oneClickTaken.has(t.signalId))
        .map((t, k) => {
          const minAsk = 0.52 + k * 0.04;
          const reason = `ONE_CLICK: giá bán thấp nhất ${minAsk} ≥ 0.5 — chờ người vào lệnh ở On click`;
          return {
            profileId: pid,
            signalId: t.signalId,
            expiresAt: now + 60_000 - k * 20_000,
            updatedAt: now - k * 1_500,
            analysis: { ...t, reason, createdAt: now - k * 1_500, detail: { ...t.detail, minAsk, oneClickMinPrice: 0.5 } },
          };
        });
      return ok(list);
    }
    if (p === 'exposure')
      return ok({
        available: true,
        error: null,
        matches: [
          { match: 'cs2:aurora~ninjasinpyjamas', usedUsd: 496.39, capUsd: matchExposureCapUsd, ttlMs: 11 * 3_600_000, profiles: [{ profileId: 'prof-a', profileName: 'Trader A', usedUsd: 48.31, capUsd: 0, ttlMs: 11 * 3_600_000 }] },
          { match: 'cs2:mindfreak~rooster', usedUsd: 60.42, capUsd: matchExposureCapUsd, ttlMs: 12 * 3_600_000, profiles: [] },
        ],
        entries: [
          { profileId: 'prof-a', profileName: 'Trader A', room: 'room:cs2:aurora~ninjasinpyjamas:map-2-winner', comboId: 'sptpub>0|polymarket>1', tierId: 't-auto', tierName: 'Phổ thông cho giao dịch tự động', count: 1, max: 1, ttlMs: 11 * 3_600_000 },
        ],
      });
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

  if (method === 'POST' && p === 'push/test') return ok({ id: `mock-${Date.now().toString(36)}`, errors: [] });
  if (method === 'POST' && p === 'oneclick/enter') {
    const sid = String(b.signalId ?? '');
    const src = trades.find((t) => t.signalId === sid && t.profileId === b.profileId);
    if (!src || oneClickTaken.has(sid)) return { status: 404, body: { message: 'Not Found' } };
    oneClickTaken.add(sid);
    trades = [{ ...src, id: `${src.id}:m`, createdAt: Date.now(), detail: { ...src.detail, manual: { by: 'admin' } } }, ...trades];
    return ok({ sent: true });
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

  if (method === 'POST' && /^profiles\/[^/]+\/reevaluate$/.test(p)) return ok({ tasks: 1 });
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
  if (method === 'POST' && p === 'exposure/reset') return ok({ keys: 1 });
  if (method === 'POST' && p === 'trades/purge') {
    const statuses = Array.isArray(b.statuses) ? (b.statuses as string[]) : [];
    if (b.all && statuses.length) return bad('TRADE_PURGE_SCOPE_CONFLICT');
    if (!b.all && !statuses.length) return bad('TRADE_PURGE_SCOPE_REQUIRED');
    const hit = (t: TradeAttempt) =>
      (!statuses.length || statuses.includes(t.status)) &&
      (!b.profileId || t.profileId === b.profileId) &&
      (!b.before || t.createdAt < Number(b.before));
    const matched = trades.filter(hit).length;
    if (!b.dryRun) trades = trades.filter((t) => !hit(t));
    return ok({ matched, deleted: b.dryRun ? 0 : matched });
  }
  const tradeId = /^trades\/([^/]+)$/.exec(p)?.[1];
  if (method === 'DELETE' && tradeId) {
    const before = trades.length;
    trades = trades.filter((t) => t.id !== decodeURIComponent(tradeId));
    return trades.length < before ? ok(true) : { status: 404, body: { message: 'Not Found' } };
  }
  if (method === 'PUT' && p === 'settings') {
    matchExposureCapUsd = Number(b.matchExposureCapUsd ?? 0);
    return ok({ matchExposureCapUsd });
  }
  return { status: 404, body: { message: 'Not Found' } };
}

/** Báo cáo tài khoản mẫu: ~7 tháng lệnh, cặp arbitrage lãi đều, mỗi chân lúc thắng lúc thua. */
function mockAccountReport(acc: TradingAccountView, modes: ReportMode[]): AccountReport {
  const DAY = 86_400_000;
  const now = Date.now();
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const teams: [string, string][] = [['NAVI', 'FaZe'], ['G2', 'Vitality'], ['T1', 'Gen.G'], ['Spirit', 'MOUZ'], ['Liquid', 'Cloud9']];
  const rows: { t: ReportTrade; mode: ReportMode; totalCost: number }[] = [];
  for (let i = 0; i < 240; i++) {
    const createdAt = now - Math.floor(rnd() * 210 * DAY);
    const stake = 20 + Math.round(rnd() * 60);
    const odds = 1.7 + rnd() * 0.8;
    const price = Math.round((1 - 1 / odds) * (0.9 + rnd() * 0.07) * 1000) / 1000;
    const shares = Math.round((stake * odds) * 100) / 100;
    const polyCost = Math.round(shares * price * 100) / 100 + 0.3;
    const settled = createdAt < now - DAY / 2 || rnd() > 0.6;
    const bookWins = rnd() < 1 / odds;
    const bookPnl = settled ? (bookWins ? stake * (odds - 1) : -stake) : null;
    const polyPnl = settled ? (bookWins ? -polyCost : shares - polyCost) : null;
    const expected = Math.min(stake * odds, shares) - stake - polyCost;
    const mode: ReportMode = i % 3 === 0 ? 'shadow' : i % 7 === 0 ? 'paper' : 'live';
    const book = { venue: 'csgoempire' as const, pick: teams[i % 5]![0], amount: stake, price: odds, cost: stake, result: settled ? (bookWins ? ('won' as const) : ('lost' as const)) : null, pnl: bookPnl };
    const poly = { venue: 'polymarket' as const, pick: teams[i % 5]![1], amount: shares, price, cost: polyCost, result: settled ? (bookWins ? ('lost' as const) : ('won' as const)) : null, pnl: polyPnl };
    rows.push({
      mode,
      totalCost: stake + polyCost,
      t: {
        id: `mock-${i}`,
        createdAt,
        mode,
        status: mode === 'live' ? 'filled' : 'paper_filled',
        profileId: 'p1',
        room: 'room:cs2:x~y:match-winner',
        market: 'match-winner',
        teams: teams[i % 5]!,
        leg: acc.venue === 'csgoempire' ? book : poly,
        other: acc.venue === 'csgoempire' ? poly : book,
        expected: Math.round(expected * 100) / 100,
        pairPnl: settled ? Math.round(((bookPnl ?? 0) + (polyPnl ?? 0)) * 100) / 100 : null,
        settlement: settled ? { winner: bookWins ? 'csgoempire' : 'polymarket', source: i % 17 === 0 ? 'manual' : 'polymarket', by: null, resolvedAt: createdAt + DAY / 4, polyPrice: bookWins ? 0 : 1 } : null,
        pairedWith: null,
      },
    });
  }
  rows.sort((a, b) => b.t.createdAt - a.t.createdAt);
  const sum = (list: typeof rows) => ({
    trades: list.length,
    settled: list.filter((r) => r.t.settlement).length,
    staked: list.reduce((n, r) => n + r.t.leg.cost, 0),
    totalCost: list.reduce((n, r) => n + r.totalCost, 0),
    expected: list.reduce((n, r) => n + r.t.expected, 0),
    legPnl: list.reduce((n, r) => n + (r.t.leg.pnl ?? 0), 0),
    pairPnl: list.reduce((n, r) => n + (r.t.pairPnl ?? 0), 0),
  });
  const picked = rows.filter((r) => modes.includes(r.mode));
  const key = (at: number, p: ReportPeriod) => {
    const d = new Date(at + 7 * 3_600_000);
    const y = d.getUTCFullYear();
    const m = d.getUTCMonth() + 1;
    const pad = (n: number) => String(n).padStart(2, '0');
    if (p === 'day') return `${y}-${pad(m)}-${pad(d.getUTCDate())}`;
    if (p === 'week') {
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    }
    if (p === 'month') return `${y}-${pad(m)}`;
    if (p === 'quarter') return `${y}-Q${Math.ceil(m / 3)}`;
    return String(y);
  };
  const series = Object.fromEntries(
    (['day', 'week', 'month', 'quarter', 'year'] as const).map((p) => {
      const map = new Map<string, ReportBucket>();
      for (const { t } of picked) {
        const k = key(t.createdAt, p);
        const b = map.get(k) ?? { key: k, trades: 0, settled: 0, staked: 0, legPnl: 0, pairPnl: 0, expected: 0, legWins: 0, legLosses: 0 };
        b.trades++;
        b.settled += t.settlement ? 1 : 0;
        b.staked += t.leg.cost;
        b.legPnl += t.leg.pnl ?? 0;
        b.pairPnl += t.pairPnl ?? 0;
        b.expected += t.expected;
        b.legWins += t.leg.result === 'won' ? 1 : 0;
        b.legLosses += t.leg.result === 'lost' ? 1 : 0;
        map.set(k, b);
      }
      return [p, [...map.values()].sort((a, b) => a.key.localeCompare(b.key)).slice(-60)];
    }),
  ) as Record<ReportPeriod, ReportBucket[]>;
  const totals = sum(picked);
  const legs = picked.map((r) => r.t.leg).filter((l) => l.pnl !== null);
  return {
    accountId: acc.id,
    venue: acc.venue,
    label: acc.label,
    timeZone: 'Asia/Ho_Chi_Minh',
    modes,
    generatedAt: now,
    truncated: false,
    totals: {
      ...totals,
      legWins: legs.filter((l) => l.result === 'won').length,
      legLosses: legs.filter((l) => l.result === 'lost').length,
      legVoids: 0,
      bestLeg: legs.length ? Math.max(...legs.map((l) => l.pnl!)) : null,
      worstLeg: legs.length ? Math.min(...legs.map((l) => l.pnl!)) : null,
    },
    series,
    compare: {
      byMode: {
        live: sum(rows.filter((r) => r.mode === 'live')),
        shadow: sum(rows.filter((r) => r.mode === 'shadow')),
        paper: sum(rows.filter((r) => r.mode === 'paper')),
      },
      paired: { count: 74, liveExpected: 182.4, shadowExpected: 196.1, bothSettled: 70, livePnl: 171.2, shadowPnl: 188.9, shadowOnly: 6 },
    },
    trades: picked.slice(0, 300).map((r) => r.t),
  };
}
