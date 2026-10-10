import type { MatchKey } from '../domain/match-key.js';
import type { RemovalReason } from '../domain/removal-reason.js';
import type { ArbitrageEvaluator } from './arbitrage-evaluator.js';
import type { OddsRoomStore } from './odds-room.store.js';
import type { OddsLineChange } from './raw-odds.translator.js';

/** Application service: ghi các thay đổi dòng kèo vào room rồi đánh giá lại các room bị chạm. */
export class OddsLineApplier {
  constructor(
    private readonly _rooms: OddsRoomStore,
    private readonly _evaluator: ArbitrageEvaluator,
  ) {}

  async apply(changes: readonly OddsLineChange[]): Promise<void> {
    const touched = new Map<
      string,
      { key: MatchKey; removal?: RemovalReason }
    >();
    for (const c of changes) {
      const id = c.key.toString();
      const entry = touched.get(id) ?? { key: c.key };
      if (c.type === 'set') await this._rooms.setLine(c.key, c.line);
      else {
        await this._rooms.removeLine(c.key, c.tenant);
        if (c.reason) entry.removal = c.reason;
      }
      touched.set(id, entry);
    }
    for (const { key, removal } of touched.values())
      await this._evaluator.evaluate(key, removal);
  }
}
