import { MatchKey } from '../../domain/match-key.js';
import { OddsLine } from '../../domain/odds-line.js';
import { OddsTransitionTracker } from '../odds-transition.tracker.js';
import type { OddsLineChange } from '../raw-odds.translator.js';

const key = MatchKey.of({
  sport: 'cs2',
  teamX: 'a',
  teamY: 'b',
  market: 'game-winner',
});
const set = (
  status: 'open' | 'suspended',
  odds: [number, number] = [2, 2],
): OddsLineChange => ({
  type: 'set',
  key,
  line: OddsLine.create({
    tenant: 'sptpub',
    odds,
    status,
    phase: 'live',
    updatedAt: 1,
    startsAt: 1,
    ref: {},
  }),
});
const transitions = (t: OddsTransitionTracker, c: OddsLineChange) =>
  t
    .observe(c, 1)
    .filter((e) => e.type === 'odds.transition')
    .map((e) =>
      e.type === 'odds.transition' ? `${e.data.from}→${e.data.to}` : '',
    );

describe('OddsTransitionTracker', () => {
  it('chỉ báo chuyển trạng thái, không báo đổi giá', () => {
    const t = new OddsTransitionTracker();
    expect(transitions(t, set('open'))).toEqual(['null→open']);
    expect(transitions(t, set('open', [2.1, 1.9]))).toEqual([]);
    expect(transitions(t, set('suspended'))).toEqual(['open→suspended']);
    expect(
      transitions(t, {
        type: 'remove',
        key,
        tenant: 'sptpub',
        phase: 'live',
        reason: 'publisher_stopped',
      }),
    ).toEqual(['suspended→removed']);
    // gỡ lần nữa: không còn gì để gỡ
    expect(
      transitions(t, { type: 'remove', key, tenant: 'sptpub', phase: 'live' }),
    ).toEqual([]);
  });

  it('mọi thay đổi đều có odds.changed theo topic room', () => {
    const t = new OddsTransitionTracker();
    const [changed] = t.observe(set('open'), 5);
    expect(changed).toMatchObject({
      type: 'odds.changed',
      topic: 'room:room:cs2:a~b:game-winner',
      data: { tenant: 'sptpub', odds: [2, 2], status: 'open', removed: false },
    });
  });
});
