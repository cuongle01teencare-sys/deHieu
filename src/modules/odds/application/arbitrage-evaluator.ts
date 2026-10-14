import { randomUUID } from 'node:crypto';
import type { EventPublisher } from '../../../shared/application/event-publisher.js';
import type { DomainEvent } from '../../../shared/domain/domain-event.js';
import type { ArbitrageOpportunity } from '../domain/arbitrage-opportunity.js';
import type { ArbitrageSignal } from '../domain/arbitrage-signal.js';
import type { MatchKey } from '../domain/match-key.js';
import type { RemovalReason } from '../domain/removal-reason.js';
import {
  decideSignals,
  type ComboSignalState,
} from '../domain/signal-policy.js';
import {
  ArbitrageSignalCancelled,
  ArbitrageSignalIssued,
  ArbitrageSignalRefreshed,
} from '../domain/events/arbitrage-signal.events.js';
import type { OddsRoomStore } from './odds-room.store.js';
import type { SignalStateStore } from './signal-state.store.js';
import type { ArbitrageSettingsStore } from './arbitrage-settings.js';

/** Bộ đếm từ lúc app khởi động — để kiểm chứng evaluator đang làm việc. */
export interface EvaluatorStats {
  readonly evaluations: number;
  readonly roomsEvaluated: number;
  readonly lastEvaluatedAt: number | null;
  readonly issued: number;
  readonly refreshed: number;
  readonly cancelled: number;
  readonly cancelledByReason: Readonly<Record<string, number>>;
  readonly errors: number;
  readonly lastError: string | null;
}

/**
 * Application service: đánh giá lại một room → quyết định phát/làm mới/hủy kèo → publish.
 * Gọi sau mỗi lần một tenant ghi odds, và định kỳ (sweep) để phát lại kèo quá hạn.
 */
export class ArbitrageEvaluator {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _signals: SignalStateStore,
    private readonly _settings: ArbitrageSettingsStore,
    private readonly _publisher: EventPublisher,
    private readonly _now: () => number = Date.now,
  ) {}

  /** Mỗi room chỉ một lượt đánh giá tại một thời điểm (nhiều làn có thể chạm cùng room). */
  private readonly _locks = new Map<string, Promise<void>>();

  private readonly _seenRooms = new Set<string>();
  private _stats = {
    evaluations: 0,
    lastEvaluatedAt: null as number | null,
    issued: 0,
    refreshed: 0,
    cancelled: 0,
    cancelledByReason: {} as Record<string, number>,
    errors: 0,
    lastError: null as string | null,
  };

  stats(): EvaluatorStats {
    return {
      ...this._stats,
      cancelledByReason: { ...this._stats.cancelledByReason },
      roomsEvaluated: this._seenRooms.size,
    };
  }

  evaluate(key: MatchKey, removal?: RemovalReason): Promise<void> {
    const id = key.toString();
    const prev = this._locks.get(id) ?? Promise.resolve();
    const run = prev.then(() => this._evaluate(key, removal));
    const tail = run.catch((e: unknown) => {
      this._stats.errors++;
      this._stats.lastError = e instanceof Error ? e.message : String(e);
    });
    this._locks.set(id, tail);
    void tail.then(() => {
      if (this._locks.get(id) === tail) this._locks.delete(id);
    });
    return run;
  }

  private async _evaluate(
    key: MatchKey,
    removal?: RemovalReason,
  ): Promise<void> {
    const settings = await this._settings.get();
    const room = await this._rooms.get(key);
    const roomId = key.toString();
    const now = this._now();
    this._stats.evaluations++;
    this._stats.lastEvaluatedAt = now;
    this._seenRooms.add(roomId);

    const previous = await this._signals.getCombos(roomId);
    const decisions = decideSignals(
      previous,
      room.combinations(settings.maxStartDriftMs),
      now,
      settings,
      (comboId) =>
        room.explainMissing(comboId, settings.maxStartDriftMs, removal),
    );
    if (decisions.length === 0) return;

    const next = new Map<string, ComboSignalState>(previous);
    const events: DomainEvent[] = [];

    for (const d of decisions) {
      if (d.type === 'cancel') {
        next.delete(d.comboId);
        await this._signals.removeSignals([d.signalId]);
        this._stats.cancelled++;
        this._stats.cancelledByReason[d.reason] =
          (this._stats.cancelledByReason[d.reason] ?? 0) + 1;
        events.push(
          new ArbitrageSignalCancelled(d.signalId, roomId, d.comboId, d.reason),
        );
      } else if (d.type === 'issue') {
        const signal = this._toSignal(
          randomUUID(),
          d.opportunity,
          now,
          settings.signalTtlMs,
        );
        next.set(d.opportunity.comboId, {
          comboId: d.opportunity.comboId,
          issuedMargin: d.opportunity.margin,
          lastIssuedAt: now,
          signalId: signal.signalId,
        });
        await this._signals.putSignal(signal);
        this._stats.issued++;
        events.push(new ArbitrageSignalIssued(signal));
      } else {
        const signal = this._toSignal(
          d.signalId,
          d.opportunity,
          now,
          settings.signalTtlMs,
        );
        const prev = next.get(d.opportunity.comboId);
        if (prev) next.set(prev.comboId, { ...prev, lastIssuedAt: now });
        await this._signals.putSignal(signal);
        this._stats.refreshed++;
        events.push(new ArbitrageSignalRefreshed(signal));
      }
    }

    await this._signals.saveCombos(roomId, next);
    await this._publisher.publish(events);
  }

  private _toSignal(
    signalId: string,
    o: ArbitrageOpportunity,
    now: number,
    ttl: number,
  ): ArbitrageSignal {
    return {
      signalId,
      room: o.key.toString(),
      sport: o.key.sport,
      market: o.key.market,
      teams: o.key.teams,
      comboId: o.comboId,
      phase: o.phase,
      margin: o.margin,
      legs: o.legs,
      issuedAt: now,
      expiresAt: now + ttl,
    };
  }
}
