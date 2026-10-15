import { targetStake } from '../../../../shared/domain/stake-table.js';
import type { Task, TaskContext } from '../../application/task.js';
import { sleep } from '../shared/abortable.js';
import {
  polymarketRestUrls,
  type PolymarketEndpoints,
} from '../polymarket/polymarket-environment.js';
import {
  ConsumerHubClient,
  type HubLeg,
  type HubSignal,
} from './consumer-hub.client.js';
import {
  InMemoryExposureLedger,
  RedisExposureLedger,
  type ExposureLedger,
} from './exposure-ledger.js';
import { PolymarketMarketData } from './polymarket-market-data.js';
import { TRADE_STRATEGIES } from './trade-strategies.js';
import { depthSummary } from './arbitrage-sizing.js';
import {
  TraderConfigSchema,
  type TraderConfig,
} from './trader-config.schema.js';

export interface TraderArbitrageParams {
  readonly profileId: string;
  /** WS của ConsumerHub; mặc định ws://127.0.0.1:${CONSUMER_WS_PORT}. */
  readonly hubUrl?: string;
  /** Dùng Redis (REDIS_URL) để giới hạn tổng theo trận áp cho MỌI trader. Tắt = chỉ trong task này. */
  readonly sharedExposure: boolean;
  readonly endpoints?: PolymarketEndpoints;
}

/** Kênh dữ liệu gửi về app (module trading đọc). */
const CH_CONFIG_REQUEST = 'config_request';
const CH_TRADE = 'trade';
const CONFIG_RETRY_MS = 5_000;
/**
 * Nhịp báo sống (kênh 'status') khi đang nối hub. Trader chỉ gửi dữ liệu khi có kèo nên không có nhịp này
 * watchdog sẽ báo "nguồn im lặng" lúc vắng kèo; còn mất hub thì ngừng nhịp → watchdog báo đúng.
 */
const STATUS_EVERY_MS = 30_000;
const CH_STATUS = 'status';
/** Phơi nhiễm theo trận giữ tối đa ngần này (trận kết thúc / app không giải phóng). */
const EXPOSURE_TTL_MS = 12 * 3_600_000;

type Status = 'paper_filled' | 'skipped' | 'cancelled' | 'error';

/** `room:cs2:a~b:game-winner` → `cs2:a~b` (giới hạn theo TRẬN, gộp mọi market). */
export const matchOf = (room: string): string => {
  const parts = room.replace(/^room:/, '').split(':');
  return parts.length > 2 ? parts.slice(0, -1).join(':') : parts.join(':');
};

const bare = (l: HubLeg | undefined) =>
  l
    ? {
        tenant: l.tenant,
        side: l.side,
        pick: l.pick,
        odds: l.odds,
        // link trang trận trên sàn (để admin mở kiểm tra)
        url: l.ref.url ?? null,
      }
    : null;

/**
 * Trader arbitrage (giấy): consumer của ConsumerHub. Mỗi profile một task, mọi task nhận CÙNG một
 * kèo khi publisher phát một lần. Với mỗi kèo: chọn tiền theo bảng vốn của hạng → đọc sổ lệnh + phí
 * polymarket thật → chiến lược quyết định số share → giữ phơi nhiễm theo trận (Redis) → ghi kết quả.
 * KHÔNG đặt lệnh thật. Kèo bị hủy khi đang xử lý → bỏ (AbortController theo signalId).
 */
export class TraderArbitrageTask implements Task<TraderArbitrageParams> {
  private _config: TraderConfig | null = null;
  private readonly _inflight = new Map<string, AbortController>();

  /** Thay được sổ phơi nhiễm (vd test nhiều trader dùng chung một sổ). */
  constructor(
    private readonly _deps: { readonly ledger?: ExposureLedger } = {},
  ) {}

  async run(ctx: TaskContext<TraderArbitrageParams>): Promise<void> {
    const p = ctx.params;
    const token = process.env.CONSUMER_WS_TOKEN;
    if (!token) throw new Error('thiếu CONSUMER_WS_TOKEN trong env của worker');
    const hubUrl =
      p.hubUrl ?? `ws://127.0.0.1:${process.env.CONSUMER_WS_PORT ?? '3002'}`;
    const market = new PolymarketMarketData(polymarketRestUrls(p.endpoints));
    const redisUrl = process.env.REDIS_URL;
    const ledger: ExposureLedger =
      this._deps.ledger ??
      (p.sharedExposure && redisUrl
        ? new RedisExposureLedger(redisUrl, 'trade:paper')
        : new InMemoryExposureLedger());
    if (!this._deps.ledger && p.sharedExposure && !redisUrl)
      ctx.warn(
        'không có REDIS_URL: giới hạn tổng theo trận chỉ tính trong task này',
      );

    const configured = new AbortController();
    ctx.onCommand((name, data) => {
      if (name !== 'config') throw new Error(`UNKNOWN_COMMAND: ${name}`);
      const cfg = TraderConfigSchema.parse(data);
      if (cfg.profileId !== p.profileId)
        throw new Error(`PROFILE_MISMATCH: ${cfg.profileId}`);
      this._config = cfg;
      configured.abort(); // đánh thức vòng chờ cấu hình
    });

    try {
      // chưa có cấu hình thì chưa nối hub (hub gửi lại kèo còn hiệu lực ngay khi nối)
      while (!this._config && !ctx.signal.aborted) {
        ctx.emit({ profileId: p.profileId }, CH_CONFIG_REQUEST);
        await sleep(
          CONFIG_RETRY_MS,
          AbortSignal.any([ctx.signal, configured.signal]),
        );
      }
      if (ctx.signal.aborted) return;

      let connected = false;
      const status = setInterval(() => {
        if (connected)
          ctx.emit(
            {
              profileId: p.profileId,
              hubPaused: hub.paused,
              inflight: this._inflight.size,
              active: this._config?.active ?? false,
            },
            CH_STATUS,
          );
      }, STATUS_EVERY_MS);
      const hub = new ConsumerHubClient(
        { url: hubUrl, token, consumerId: `trader:${p.profileId}` },
        {
          onSignal: (s) =>
            void this._handle(ctx, s, { market, ledger, hub }).catch((e) =>
              ctx.warn(e),
            ),
          onCancel: (c) => {
            // vd better_opportunity: kèo cũ vẫn còn lãi, publisher chỉ thay bằng kèo tốt hơn → cứ vào tiếp
            if (this._config?.risk.ignoreCancelReasons.includes(c.reason))
              return;
            this._inflight
              .get(c.signalId)
              ?.abort(`SIGNAL_CANCELLED: ${c.reason}`);
          },
          onState: (state, detail) => {
            if (state === 'connected') connected = true;
            if (state === 'disconnected') {
              connected = false;
              if (detail) ctx.warn(detail);
            }
          },
        },
      );
      try {
        await hub.run(ctx.signal);
      } finally {
        clearInterval(status);
      }
    } finally {
      for (const ac of this._inflight.values()) ac.abort('TASK_STOPPED');
      await ledger.close();
    }
  }

  private async _handle(
    ctx: TaskContext<TraderArbitrageParams>,
    s: HubSignal,
    deps: {
      market: PolymarketMarketData;
      ledger: ExposureLedger;
      hub: ConsumerHubClient;
    },
  ): Promise<void> {
    const startedAt = Date.now();
    const cfg = this._config;
    if (!cfg) return;
    const profileId = ctx.params.profileId;
    // hub giao "ít nhất một lần" và gửi lại kèo còn hiệu lực khi nối lại → mỗi kèo xử lý MỘT lần
    const ttl = Math.max(0, s.expiresAt - startedAt) + 3_600_000;
    if (!(await deps.ledger.claim(profileId, s.signalId, ttl))) return;

    const book = s.legs.find((l) => l.tenant === 'sptpub');
    const poly = s.legs.find((l) => l.tenant === 'polymarket');
    const pick = targetStake(cfg.stakeTable, s.margin);
    const base = {
      id: `${profileId}:${s.signalId}`,
      profileId,
      mode: cfg.mode,
      signalId: s.signalId,
      room: s.room,
      sport: s.sport,
      market: s.market,
      teams: [s.teams[0], s.teams[1]] as [string, string],
      phase: s.phase,
      comboId: s.comboId,
      signalMargin: s.margin,
      tierName: pick?.row.tierName ?? null,
    };
    let marketDataAt: number | null = null;
    const emit = (
      status: Status,
      reason: string | null,
      r: Partial<{
        legs: Record<string, unknown>[];
        stake: number;
        tokenId: string;
        shares: number;
        avgPrice: number;
        fee: number;
        polyCost: number;
        totalCost: number;
        payout: number;
        profit: number;
        netMargin: number;
        detail: Record<string, unknown>;
      }> = {},
    ) =>
      ctx.emit(
        {
          ...base,
          status,
          reason,
          book: book ? { ...bare(book)!, stake: r.stake ?? 0 } : null,
          polymarket: poly
            ? {
                ...bare(poly)!,
                tokenId: r.tokenId ?? '',
                shares: r.shares ?? 0,
                avgPrice: r.avgPrice ?? 0,
                fee: r.fee ?? 0,
                cost: r.polyCost ?? 0,
              }
            : null,
          totalCost: r.totalCost ?? 0,
          payout: r.payout ?? 0,
          profit: r.profit ?? 0,
          netMargin: r.netMargin ?? 0,
          latencyMs: Date.now() - startedAt,
          detail: {
            signalAgeMs: startedAt - s.issuedAt,
            targetStake: pick?.stake ?? null,
            ...r.detail,
          },
          createdAt: Date.now(),
          csgoempireAccountId: cfg.accounts.csgoempire?.id ?? null,
          polymarketAccountId: cfg.accounts.polymarket?.id ?? null,
          timing: {
            signalIssuedAt: s.issuedAt,
            receivedAt: startedAt,
            marketDataAt,
            decidedAt: Date.now(),
          },
          legs: r.legs ?? [],
        },
        CH_TRADE,
      );

    if (!cfg.active) return emit('skipped', `INACTIVE: ${cfg.inactiveReason}`);
    if (deps.hub.paused) return emit('skipped', 'HUB_PAUSED');
    if (s.expiresAt <= startedAt) return emit('skipped', 'SIGNAL_EXPIRED');
    if (
      cfg.risk.maxSignalAgeMs > 0 &&
      startedAt - s.issuedAt > cfg.risk.maxSignalAgeMs
    )
      return emit(
        'skipped',
        `STALE_SIGNAL: ${startedAt - s.issuedAt}ms > ${cfg.risk.maxSignalAgeMs}ms`,
      );
    if (!book || !poly)
      return emit('skipped', `UNSUPPORTED_COMBO: ${s.comboId}`);
    const tokenId = poly.ref[`t${poly.side}`];
    const conditionId = poly.ref.c;
    if (!tokenId || !conditionId)
      return emit('skipped', 'MISSING_REF: thiếu token/conditionId polymarket');
    if (!pick)
      return emit('skipped', `NO_TIER: margin ${(s.margin * 100).toFixed(2)}%`);
    if (!pick.row.enabled)
      return emit(
        'skipped',
        `TIER_NOT_SELECTED: hạng ${pick.row.tierName} không nằm trong các hạng profile được vào`,
      );
    // mỗi hạng kèo tính riêng: cùng cửa ở hạng này đã đủ số lệnh → bỏ qua (kèo phát lại = signalId mới, vẫn cửa cũ)
    const max = cfg.risk.maxEntriesPerTier;
    const entryKey = `entry:${profileId}:${s.room}:${s.comboId}:${pick.row.tierId}`;
    const entered = await deps.ledger.count(entryKey);
    if (entered >= max)
      return emit(
        'skipped',
        `ALREADY_ENTERED: cửa này đã vào ${entered}/${max} lệnh ở hạng ${pick.row.tierName}`,
      );
    const strategy = TRADE_STRATEGIES[cfg.strategy.id];
    if (!strategy)
      return emit('skipped', `UNKNOWN_STRATEGY: ${cfg.strategy.id}`);

    const ac = new AbortController();
    this._inflight.set(s.signalId, ac);
    const signal = AbortSignal.any([ac.signal, ctx.signal]);
    try {
      const [ob, info] = await Promise.all([
        deps.market.orderBook(tokenId, signal),
        deps.market.tradingInfo(conditionId, signal),
      ]);
      marketDataAt = Date.now();
      if (signal.aborted)
        return emit('cancelled', String(signal.reason), {
          tokenId,
          detail: { cancelledAfterMs: Date.now() - startedAt },
        });
      if (!info.acceptingOrders) return emit('skipped', 'MARKET_CLOSED');

      const match = matchOf(s.room);
      const caps = [
        { key: `match:${match}`, cap: cfg.matchExposureCapUsd },
        {
          key: `profile:${profileId}:match:${match}`,
          cap: cfg.risk.matchCapUsd,
        },
      ].filter((c) => c.cap > 0);
      const used = await deps.ledger.used(caps.map((c) => c.key));
      const budget = caps.length
        ? Math.max(0, Math.min(...caps.map((c, i) => c.cap - (used[i] ?? 0))))
        : Number.POSITIVE_INFINITY;

      const d = await strategy.decide({
        margin: s.margin,
        bookOdds: book.odds,
        book: ob,
        market: info,
        targetStake: pick.stake,
        minStake: pick.row.minStake,
        minNetMargin: cfg.risk.minNetMargin,
        budget,
        params: cfg.strategy.params,
      });
      if (signal.aborted)
        return emit('cancelled', String(signal.reason), {
          tokenId,
          detail: { cancelledAfterMs: Date.now() - startedAt },
        });
      const bestAsk = ob.asks[0]?.price ?? null;
      const depth = depthSummary({
        bookOdds: book.odds,
        asks: ob.asks,
        fee: info.fee,
        targetStake: pick.stake,
        minNetMargin: cfg.risk.minNetMargin,
      });
      const sizing = {
        targetStake: pick.stake,
        minStake: pick.row.minStake,
        minShares: Math.max(info.minShares, ob.minShares ?? 0),
        minNetMargin: cfg.risk.minNetMargin,
      };
      if (!d.ok)
        return emit('skipped', `${d.reason}: ${d.detail}`, {
          tokenId,
          detail: {
            bestAsk,
            budget: Number.isFinite(budget) ? budget : null,
            fee: info.fee,
            depth,
            sizing,
            bookAt: ob.at,
          },
        });

      // lấy suất của hạng trước (nguyên tử) rồi mới giữ hạn mức: kèo trùng cửa đến cùng lúc không vượt số lệnh
      if (!(await deps.ledger.acquire(entryKey, max, EXPOSURE_TTL_MS)))
        return emit(
          'skipped',
          `ALREADY_ENTERED: cửa này vừa đủ ${max} lệnh ở hạng ${pick.row.tierName}`,
          { tokenId },
        );
      if (!(await deps.ledger.reserve(caps, d.totalCost, EXPOSURE_TTL_MS))) {
        await deps.ledger.giveBack(entryKey);
        return emit(
          'skipped',
          'CAP_REACHED: giới hạn tổng theo trận vừa bị trader khác dùng hết',
          {
            tokenId,
          },
        );
      }
      return emit('paper_filled', null, {
        stake: d.stake,
        tokenId,
        shares: d.shares,
        avgPrice: d.avgPrice,
        fee: d.fee,
        polyCost: d.polyCost,
        totalCost: d.totalCost,
        payout: d.payout,
        profit: d.profit,
        netMargin: d.netMargin,
        // giấy: hai chân "khớp" đúng như tính toán; giao dịch thật sẽ ghi giá/thời điểm khớp thật
        legs: [
          {
            venue: 'csgoempire',
            accountId: cfg.accounts.csgoempire?.id ?? null,
            side: book.side,
            pick: book.pick,
            signalPrice: book.odds,
            requestedPrice: book.odds,
            requestedAmount: d.stake,
            filledAmount: d.stake,
            avgPrice: book.odds,
            fee: 0,
            cost: d.stake,
            status: 'simulated',
            marketRef: JSON.stringify(book.ref),
          },
          {
            venue: 'polymarket',
            accountId: cfg.accounts.polymarket?.id ?? null,
            side: poly.side,
            pick: poly.pick,
            signalPrice: poly.odds > 0 ? 1 / poly.odds : 0,
            // giá xa nhất đã ăn = giá giới hạn sẽ dùng cho lệnh FOK/FAK thật
            requestedPrice: d.levels.at(-1)?.price ?? d.avgPrice,
            requestedAmount: d.shares,
            filledAmount: d.shares,
            avgPrice: d.avgPrice,
            fee: d.fee,
            cost: d.polyCost,
            status: 'simulated',
            marketRef: tokenId,
          },
        ],
        detail: {
          bestAsk,
          levels: d.levels,
          limitedBy: d.limitedBy,
          fee: info.fee,
          budget: Number.isFinite(budget) ? budget : null,
          bookAt: ob.at,
          depth,
          sizing,
        },
      });
    } catch (e: unknown) {
      if (signal.aborted)
        return emit('cancelled', String(signal.reason), {
          tokenId,
          detail: { cancelledAfterMs: Date.now() - startedAt },
        });
      return emit('error', e instanceof Error ? e.message : String(e), {
        tokenId,
      });
    } finally {
      if (this._inflight.get(s.signalId) === ac)
        this._inflight.delete(s.signalId);
    }
  }
}
