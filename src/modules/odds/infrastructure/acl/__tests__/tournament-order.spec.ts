import { describe, expect, it } from 'vitest';
import { TournamentOrder } from '../tournament-order.js';

describe('TournamentOrder', () => {
  it('xếp theo giờ bắt đầu trong từng giải; đổi giờ / bỏ trận thì tính lại', () => {
    const o = new TournamentOrder();
    o.set('c', 'g1', 3_000);
    o.set('a', 'g1', 1_000);
    o.set('b', 'g1', 2_000);
    o.set('x', 'g2', 500);
    expect(o.position('c')).toEqual({ no: 3, of: 3 });
    expect(o.position('x')).toEqual({ no: 1, of: 1 });
    o.set('c', 'g1', 0); // dời giờ lên sớm nhất
    expect(o.position('c')).toEqual({ no: 1, of: 3 });
    expect(o.position('a')).toEqual({ no: 2, of: 3 });
    o.delete('a');
    expect(o.position('b')).toEqual({ no: 2, of: 2 });
    o.set('b', 'g2', 100); // đổi giải
    expect(o.position('b')).toEqual({ no: 1, of: 2 });
    expect(o.position('c')).toEqual({ no: 1, of: 1 });
    expect(o.refFields('b', 'IEM')).toEqual({
      tour: 'IEM',
      tno: '1',
      tof: '2',
    });
    expect(o.refFields('khong-co', 'IEM')).toEqual({});
  });
});
