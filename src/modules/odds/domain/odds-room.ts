import type { MatchKey } from './match-key.js';
import { combinePhases } from './phase.js';
import { pickOf } from './pick.js';
import type { CancelReason, RemovalReason } from './removal-reason.js';
import type { OddsLine } from './odds-line.js';
import type { SignalCloseDetail } from './signal-close-detail.js';
import {
  arbitrageMargin,
  type ArbitrageOpportunity,
} from './arbitrage-opportunity.js';

/**
 * Room = mọi dòng kèo (mỗi tenant một dòng) của cùng trận + cùng market.
 * Không ghép theo cặp tenant: một room chứa tất cả, tổ hợp được tính khi cần.
 */
export class OddsRoom {
  constructor(
    public readonly key: MatchKey,
    public readonly lines: ReadonlyMap<string, OddsLine>,
  ) {}

  /**
   * Mọi tổ hợp hợp lệ (2 chân khác tenant, cả hai đang mở, giờ bắt đầu lệch ≤ maxStartDriftMs),
   * KHÔNG lọc theo ngưỡng — chính sách phát kèo (signal-policy) lo việc đó.
   */
  combinations(maxStartDriftMs: number): ArbitrageOpportunity[] {
    const open = [...this.lines.values()].filter((l) => l.isOpen);
    const result: ArbitrageOpportunity[] = [];

    for (const a of open)
      for (const b of open) {
        if (a.props.tenant === b.props.tenant) continue;
        if (Math.abs(a.props.startsAt - b.props.startsAt) > maxStartDriftMs)
          continue;
        const oddsA = a.props.odds[0];
        const oddsB = b.props.odds[1];
        result.push({
          key: this.key,
          comboId: `${a.props.tenant}>0|${b.props.tenant}>1`,
          phase: combinePhases(a.props.phase, b.props.phase),
          margin: arbitrageMargin(oddsA, oddsB),
          legs: [
            {
              tenant: a.props.tenant,
              side: 0,
              pick: pickOf(this.key, 0),
              odds: oddsA,
              ref: a.props.ref,
              startsAt: a.props.startsAt,
            },
            {
              tenant: b.props.tenant,
              side: 1,
              pick: pickOf(this.key, 1),
              odds: oddsB,
              ref: b.props.ref,
              startsAt: b.props.startsAt,
            },
          ],
        });
      }
    return result;
  }

  /**
   * Một tổ hợp từng hợp lệ nay không còn trong combinations(): vì sao?
   * `removal` là lý do gỡ odds mà use case biết (vd publisher_stopped); mặc định leg_removed.
   */
  explainMissing(
    comboId: string,
    maxStartDriftMs: number,
    removal: RemovalReason = 'leg_removed',
  ): CancelReason {
    const tenants = OddsRoom.tenantsOf(comboId);
    if (!tenants) return removal;
    const legs = tenants.map((t) => this.lines.get(t));
    if (legs.some((l) => !l)) return removal;
    if (legs.some((l) => l && !l.isOpen)) return 'leg_suspended';
    const [a, b] = legs as [OddsLine, OddsLine];
    if (Math.abs(a.props.startsAt - b.props.startsAt) > maxStartDriftMs)
      return 'start_time_mismatch';
    return removal;
  }

  /** Giờ bắt đầu từng chân của tổ hợp lúc này + độ lệch (đính vào sự kiện hủy kèo). */
  closeDetail(comboId: string, maxStartDriftMs: number): SignalCloseDetail {
    const tenants = OddsRoom.tenantsOf(comboId) ?? [];
    const startTimes = tenants.flatMap((tenant) => {
      const l = this.lines.get(tenant);
      return l ? [{ tenant, startsAt: l.props.startsAt }] : [];
    });
    const [a, b] = startTimes;
    return {
      startTimes,
      startDriftMs:
        startTimes.length === 2 && a && b
          ? Math.abs(a.startsAt - b.startsAt)
          : null,
      maxStartDriftMs,
    };
  }

  /** 'sptpub>0|polymarket>1' → ['sptpub', 'polymarket'] */
  static tenantsOf(comboId: string): [string, string] | null {
    const m = /^([^>|]+)>0\|([^>|]+)>1$/.exec(comboId);
    return m ? [m[1], m[2]] : null;
  }
}
