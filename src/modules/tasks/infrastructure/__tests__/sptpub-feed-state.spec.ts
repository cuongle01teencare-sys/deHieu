import { SptPubFeedState } from '../sptpub/sptpub-feed-state.js';

const ev = (k1: string, k2: string, extra: Record<string, unknown> = {}) => ({
  desc: { sport: '109', competitors: [{ name: 'A' }, { name: 'B' }] },
  markets: { '186': { '': { '4': { k: k1 }, '5': { k: k2 } } }, ...extra },
});
const map1 = { '330': { 'mapnr=1': { '4': { k: '2' }, '5': { k: '1.8' } } } };

describe('SptPubFeedState', () => {
  it('gộp snapshot + delta, null gỡ ở mọi cấp', () => {
    const s = new SptPubFeedState();
    s.apply({ A: ev('2.58', '1.45', map1) });
    s.apply({ A: { markets: { '186': { '': { '4': { k: '2.6' } } } } } });
    s.apply({ A: { markets: { '330': null } } });
    const fresh = new SptPubFeedState();
    fresh.apply({ A: ev('2.6', '1.45') });
    expect(s.diffTo(fresh)).toEqual({});
  });

  it('diff: giá đổi, market/event bị gỡ không có delta, event mới', () => {
    const cur = new SptPubFeedState();
    cur.apply({ A: ev('2.58', '1.45', map1), B: ev('1.5', '2.5') });
    const fresh = new SptPubFeedState();
    fresh.apply({ A: ev('2.62', '1.47'), C: ev('1.9', '1.9') });
    expect(cur.diffTo(fresh)).toEqual({
      A: {
        markets: {
          '186': { '': { '4': { k: '2.62' }, '5': { k: '1.47' } } },
          '330': null,
        },
      },
      B: null,
      C: ev('1.9', '1.9'),
    });
  });

  it('desc đổi (vd giờ thi đấu) → gửi kèm desc mới', () => {
    const cur = new SptPubFeedState();
    cur.apply({ A: ev('2', '2') });
    const fresh = new SptPubFeedState();
    fresh.apply({
      A: { ...ev('2', '2'), desc: { sport: '109', scheduled: 2 } },
    });
    expect(cur.diffTo(fresh)).toEqual({
      A: { desc: { sport: '109', scheduled: 2 } },
    });
  });
});
