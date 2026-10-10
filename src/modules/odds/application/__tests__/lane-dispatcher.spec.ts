import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';
import type { Phase } from '../../domain/phase.js';
import { LaneDispatcher } from '../lane-dispatcher.js';
import type { OddsLineApplier } from '../odds-line-applier.js';
import type { OddsLineChange } from '../raw-odds.translator.js';

const key = MatchKey.of({
  sport: 'cs2',
  teamX: 'a',
  teamY: 'b',
  market: 'game-winner',
});
const set = (tenant: string, phase: Phase, odds: number): OddsLineChange => ({
  type: 'set',
  key,
  line: OddsLine.create({
    tenant,
    odds: [odds, 2],
    status: 'open',
    phase,
    updatedAt: 0,
    startsAt: 0,
    ref: {},
  }),
});

/** applier giả: lượt đầu của mỗi làn bị treo tới khi gọi release(). */
const fakeApplier = () => {
  const calls: { phase: Phase; odds: number[] }[] = [];
  const gates: (() => void)[] = [];
  const applier = {
    apply: (batch: OddsLineChange[]) => {
      calls.push({
        phase:
          batch[0].type === 'set' ? batch[0].line.props.phase : batch[0].phase,
        odds: batch.map((c) => (c.type === 'set' ? c.line.props.odds[0] : 0)),
      });
      return new Promise<void>((r) => gates.push(r));
    },
  } as unknown as OddsLineApplier;
  return {
    applier,
    calls,
    releaseAll: () => gates.splice(0).forEach((g) => g()),
  };
};

describe('LaneDispatcher', () => {
  it('live đang bận không chặn prematch', async () => {
    const f = fakeApplier();
    const d = new LaneDispatcher(f.applier);
    void d.submit([set('sptpub', 'live', 1.5)]);
    void d.submit([set('sptpub', 'prematch', 3)]);
    await Promise.resolve();
    expect(f.calls.map((c) => c.phase)).toEqual(['live', 'prematch']); // cả hai làn cùng chạy
    f.releaseAll();
  });

  it('khi làn bận, cập nhật cùng room + tenant được gộp, chỉ giữ bản mới nhất', async () => {
    const f = fakeApplier();
    const d = new LaneDispatcher(f.applier);
    const first = d.submit([set('sptpub', 'live', 1.5)]);
    const rest = [1.6, 1.7, 1.8].map((o) =>
      d.submit([set('sptpub', 'live', o)]),
    );
    expect(d.stats()[0]).toMatchObject({
      lane: 'sptpub:live',
      queued: 1,
      coalesced: 2,
    });

    f.releaseAll();
    await first;
    await new Promise((r) => setTimeout(r, 0));
    expect(f.calls.map((c) => c.odds)).toEqual([[1.5], [1.8]]);
    f.releaseAll();
    await Promise.all(rest);
  });
});
