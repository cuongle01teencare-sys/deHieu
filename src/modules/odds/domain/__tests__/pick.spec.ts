import { MatchKey } from '../match-key.js';
import { pickOf } from '../pick.js';
import type { MarketType } from '../market-type.js';

const key = (market: MarketType) =>
  MatchKey.of({ sport: 'cs2', teamX: 'sinners', teamY: 'alliance', market });

describe('pickOf', () => {
  it('game-winner → tên đội', () => {
    expect(pickOf(key('game-winner'), 0)).toBe('alliance');
    expect(pickOf(key('game-winner'), 1)).toBe('sinners');
  });

  it('map-handicap → tên đội + mức chấp của chính đội đó', () => {
    expect(pickOf(key('map-handicap-p1.5'), 0)).toBe('alliance +1.5');
    expect(pickOf(key('map-handicap-p1.5'), 1)).toBe('sinners -1.5');
    expect(pickOf(key('map-handicap-m2.5'), 0)).toBe('alliance -2.5');
    expect(pickOf(key('map-handicap-m2.5'), 1)).toBe('sinners +2.5');
  });

  it('total-maps → over / under, không có tên đội', () => {
    expect(pickOf(key('total-maps-2.5'), 0)).toBe('over 2.5');
    expect(pickOf(key('total-maps-2.5'), 1)).toBe('under 2.5');
  });

  it('map-winner → tên đội + số map', () => {
    expect(pickOf(key('map-1-winner'), 0)).toBe('alliance (map 1)');
    expect(pickOf(key('map-3-winner'), 1)).toBe('sinners (map 3)');
  });
});
