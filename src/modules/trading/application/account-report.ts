import type { TradeAttempt } from './trade-attempt.js';
import { legAmounts, type TradeSettlement } from './trade-settlement.js';
import type { TradingVenue } from '../domain/trading-account.js';

/** Mode lệnh: thật, giấy đối chiếu của lệnh thật, giấy (profile chạy giấy). */
export const REPORT_MODES = ['live', 'shadow', 'paper'] as const;
export type ReportMode = (typeof REPORT_MODES)[number];

export const REPORT_PERIODS = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
] as const;
export type ReportPeriod = (typeof REPORT_PERIODS)[number];

export interface ReportBucket {
  /** day: 2026-10-16 · week: ngày thứ Hai 2026-10-12 · month: 2026-10 · quarter: 2026-Q4 · year: 2026 */
  readonly key: string;
  readonly trades: number;
  readonly settled: number;
  /** Tiền chân của tài khoản này đã bỏ ra. */
  readonly staked: number;
  /** Lãi/lỗ CHÂN của tài khoản này (lệnh đã có kết quả). */
  readonly legPnl: number;
  /** Lãi/lỗ CẢ CẶP (lệnh đã có kết quả) — con số thật của profile. */
  readonly pairPnl: number;
  /** Lãi dự kiến cả cặp lúc vào lệnh (mọi lệnh). */
  readonly expected: number;
  readonly legWins: number;
  readonly legLosses: number;
}

export interface ReportLeg {
  readonly venue: TradingVenue;
  readonly pick: string;
  /** csgoempire: tiền cược; polymarket: số share. */
  readonly amount: number;
  /** csgoempire: odds; polymarket: giá trung bình. */
  readonly price: number;
  readonly cost: number;
  readonly result: 'won' | 'lost' | 'void' | null;
  readonly pnl: number | null;
}

export interface ReportTrade {
  readonly id: string;
  readonly createdAt: number;
  readonly mode: string;
  readonly status: string;
  readonly profileId: string;
  readonly room: string;
  readonly market: string;
  readonly teams: readonly [string, string];
  /** Chân của tài khoản đang xem. */
  readonly leg: ReportLeg;
  /** Chân còn lại của cặp (sàn kia). */
  readonly other: ReportLeg;
  readonly expected: number;
  readonly pairPnl: number | null;
  readonly settlement: Pick<
    TradeSettlement,
    'winner' | 'source' | 'by' | 'resolvedAt' | 'polyPrice'
  > | null;
  /** id lệnh thật nếu đây là giấy đối chiếu, hoặc id bản đối chiếu nếu đây là lệnh thật. */
  readonly pairedWith: string | null;
}

export interface ModeSummary {
  readonly trades: number;
  readonly settled: number;
  readonly staked: number;
  readonly totalCost: number;
  readonly expected: number;
  readonly legPnl: number;
  readonly pairPnl: number;
}

export interface AccountReport {
  readonly accountId: string;
  readonly venue: TradingVenue;
  readonly label: string;
  readonly timeZone: string;
  readonly modes: readonly ReportMode[];
  readonly generatedAt: number;
  /** Có thể thiếu lệnh cũ hơn nếu đạt giới hạn số dòng. */
  readonly truncated: boolean;
  readonly totals: ModeSummary & {
    readonly legWins: number;
    readonly legLosses: number;
    readonly legVoids: number;
    readonly bestLeg: number | null;
    readonly worstLeg: number | null;
  };
  readonly series: Readonly<Record<ReportPeriod, readonly ReportBucket[]>>;
  /** Thật ↔ giấy: luôn tính đủ ba mode, không phụ thuộc bộ lọc. */
  readonly compare: {
    readonly byMode: Readonly<Record<ReportMode, ModeSummary>>;
    /** Lệnh thật có bản giấy đối chiếu (so từng cặp). */
    readonly paired: {
      readonly count: number;
      readonly liveExpected: number;
      readonly shadowExpected: number;
      readonly bothSettled: number;
      readonly livePnl: number;
      readonly shadowPnl: number;
      /** Giấy có vào mà thật không khớp (thiếu tiền, sàn từ chối...). */
      readonly shadowOnly: number;
    };
  };
  readonly trades: readonly ReportTrade[];
}

const SERIES_LIMIT: Record<ReportPeriod, number> = {
  day: 90,
  week: 52,
  month: 36,
  quarter: 16,
  year: 20,
};

const modeOf = (t: TradeAttempt): ReportMode =>
  t.mode === 'live' || t.mode === 'shadow' ? t.mode : 'paper';

/** Các khóa kỳ (ngày/tuần/tháng/quý/năm) của một thời điểm theo múi giờ. */
export function periodKeys(
  at: number,
  timeZone: string,
): Record<ReportPeriod, string> {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  const y = get('year');
  const m = get('month');
  const d = get('day');
  const pad = (n: number) => String(n).padStart(2, '0');
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - ((utc.getUTCDay() + 6) % 7));
  return {
    day: `${y}-${pad(m)}-${pad(d)}`,
    week: `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}`,
    month: `${y}-${pad(m)}`,
    quarter: `${y}-Q${Math.ceil(m / 3)}`,
    year: String(y),
  };
}

const text = (v: unknown) => (typeof v === 'string' ? v : '');
const r2 = (n: number) => Math.round(n * 1e6) / 1e6;

function legsOf(
  t: TradeAttempt,
  s: TradeSettlement | null,
): Record<TradingVenue, ReportLeg> {
  const a = legAmounts(t);
  const bl = t.legs.find((l) => l.venue === 'csgoempire');
  const pl = t.legs.find((l) => l.venue === 'polymarket');
  return {
    csgoempire: {
      venue: 'csgoempire',
      pick: t.book?.pick ?? bl?.pick ?? '—',
      amount: a.stake,
      price: a.odds,
      cost: a.stake,
      result: s?.bookResult ?? null,
      pnl: s ? s.bookPnl : null,
    },
    polymarket: {
      venue: 'polymarket',
      pick: t.polymarket?.pick ?? pl?.pick ?? '—',
      amount: a.shares,
      price: a.shares > 0 ? (pl?.avgPrice ?? t.polymarket?.avgPrice ?? 0) : 0,
      cost: a.polyCost,
      result: s
        ? s.winner === 'polymarket'
          ? 'won'
          : s.winner === 'csgoempire'
            ? 'lost'
            : 'void'
        : null,
      pnl: s ? s.polyPnl : null,
    },
  };
}

const emptySummary = (): {
  -readonly [K in keyof ModeSummary]: number;
} => ({
  trades: 0,
  settled: 0,
  staked: 0,
  totalCost: 0,
  expected: 0,
  legPnl: 0,
  pairPnl: 0,
});

/**
 * Báo cáo một tài khoản. `rows` = mọi lệnh có tiền của tài khoản (mọi mode); `modes` chỉ lọc phần
 * tổng / chuỗi thời gian / danh sách, phần so sánh thật ↔ giấy luôn dùng đủ.
 */
export function buildAccountReport(input: {
  readonly account: { id: string; label: string; venue: TradingVenue };
  readonly rows: readonly {
    trade: TradeAttempt;
    settlement: TradeSettlement | null;
  }[];
  readonly modes: readonly ReportMode[];
  readonly timeZone: string;
  readonly truncated: boolean;
  readonly tradeLimit?: number;
  readonly now?: number;
}): AccountReport {
  const { account, timeZone } = input;
  const venue = account.venue;
  const otherVenue: TradingVenue =
    venue === 'csgoempire' ? 'polymarket' : 'csgoempire';
  const byMode = {
    live: emptySummary(),
    shadow: emptySummary(),
    paper: emptySummary(),
  };
  const totals = {
    ...emptySummary(),
    legWins: 0,
    legLosses: 0,
    legVoids: 0,
    bestLeg: null as number | null,
    worstLeg: null as number | null,
  };
  const buckets = Object.fromEntries(
    REPORT_PERIODS.map((p) => [p, new Map<string, ReportBucket>()]),
  ) as Record<ReportPeriod, Map<string, ReportBucket>>;
  const trades: ReportTrade[] = [];
  const ids = new Set(input.rows.map((r) => r.trade.id));
  const live = new Map<string, TradeSettlement | null>();
  const shadow = new Map<
    string,
    { expected: number; settlement: TradeSettlement | null }
  >();

  for (const { trade: t, settlement: s } of input.rows) {
    const mode = modeOf(t);
    const legs = legsOf(t, s);
    const leg = legs[venue];
    const add = (x: ReturnType<typeof emptySummary>) => {
      x.trades++;
      x.staked += leg.cost;
      x.totalCost += t.totalCost;
      x.expected += t.profit;
      if (s) {
        x.settled++;
        x.legPnl += leg.pnl ?? 0;
        x.pairPnl += s.pnl;
      }
    };
    add(byMode[mode]);
    if (mode === 'live') live.set(t.id, s);
    if (mode === 'shadow')
      shadow.set(text(t.detail.shadowOf) || t.id.replace(/:shadow$/, ''), {
        expected: t.profit,
        settlement: s,
      });
    if (!input.modes.includes(mode)) continue;

    add(totals);
    if (s && leg.pnl !== null) {
      if (leg.result === 'won') totals.legWins++;
      else if (leg.result === 'lost') totals.legLosses++;
      else totals.legVoids++;
      totals.bestLeg = Math.max(totals.bestLeg ?? leg.pnl, leg.pnl);
      totals.worstLeg = Math.min(totals.worstLeg ?? leg.pnl, leg.pnl);
    }
    const keys = periodKeys(t.createdAt, timeZone);
    for (const p of REPORT_PERIODS) {
      const b = buckets[p].get(keys[p]) ?? {
        key: keys[p],
        trades: 0,
        settled: 0,
        staked: 0,
        legPnl: 0,
        pairPnl: 0,
        expected: 0,
        legWins: 0,
        legLosses: 0,
      };
      buckets[p].set(keys[p], {
        ...b,
        trades: b.trades + 1,
        settled: b.settled + (s ? 1 : 0),
        staked: r2(b.staked + leg.cost),
        legPnl: r2(b.legPnl + (leg.pnl ?? 0)),
        pairPnl: r2(b.pairPnl + (s?.pnl ?? 0)),
        expected: r2(b.expected + t.profit),
        legWins: b.legWins + (leg.result === 'won' ? 1 : 0),
        legLosses: b.legLosses + (leg.result === 'lost' ? 1 : 0),
      });
    }
    if (trades.length < (input.tradeLimit ?? 300)) {
      const pairedId =
        mode === 'shadow'
          ? text(t.detail.shadowOf)
          : mode === 'live' && ids.has(`${t.id}:shadow`)
            ? `${t.id}:shadow`
            : null;
      trades.push({
        id: t.id,
        createdAt: t.createdAt,
        mode: t.mode,
        status: t.status,
        profileId: t.profileId,
        room: t.room,
        market: t.market,
        teams: t.teams,
        leg,
        other: legs[otherVenue],
        expected: t.profit,
        pairPnl: s ? s.pnl : null,
        settlement: s
          ? {
              winner: s.winner,
              source: s.source,
              by: s.by,
              resolvedAt: s.resolvedAt,
              polyPrice: s.polyPrice,
            }
          : null,
        pairedWith: pairedId || null,
      });
    }
  }

  let count = 0;
  let liveExpected = 0;
  let shadowExpected = 0;
  let bothSettled = 0;
  let livePnl = 0;
  let shadowPnl = 0;
  let shadowOnly = 0;
  const liveRows = new Map(
    input.rows
      .filter((r) => modeOf(r.trade) === 'live')
      .map((r) => [r.trade.id, r.trade]),
  );
  for (const [liveId, sh] of shadow) {
    const lt = liveRows.get(liveId);
    if (!lt) {
      shadowOnly++;
      continue;
    }
    count++;
    liveExpected += lt.profit;
    shadowExpected += sh.expected;
    const ls = live.get(liveId);
    if (ls && sh.settlement) {
      bothSettled++;
      livePnl += ls.pnl;
      shadowPnl += sh.settlement.pnl;
    }
  }

  const round = <T extends Record<string, number | null>>(o: T): T =>
    Object.fromEntries(
      Object.entries(o).map(([k, v]) => [k, v === null ? null : r2(v)]),
    ) as T;

  return {
    accountId: account.id,
    venue,
    label: account.label,
    timeZone,
    modes: input.modes,
    generatedAt: input.now ?? Date.now(),
    truncated: input.truncated,
    totals: round(totals),
    series: Object.fromEntries(
      REPORT_PERIODS.map((p) => [
        p,
        [...buckets[p].values()]
          .sort((a, b) => a.key.localeCompare(b.key))
          .slice(-SERIES_LIMIT[p]),
      ]),
    ) as Record<ReportPeriod, ReportBucket[]>,
    compare: {
      byMode: {
        live: round(byMode.live),
        shadow: round(byMode.shadow),
        paper: round(byMode.paper),
      },
      paired: round({
        count,
        liveExpected,
        shadowExpected,
        bothSettled,
        livePnl,
        shadowPnl,
        shadowOnly,
      }),
    },
    trades,
  };
}
