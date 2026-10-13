import { z } from 'zod';
import { queryDate } from '../query-date.js';

describe('queryDate', () => {
  const Q = z.object({ from: queryDate() });

  it('nhận Unix ms dạng chuỗi (web gửi) và ISO 8601', () => {
    expect(Q.parse({ from: '1791816000000' }).from?.getTime()).toBe(
      1791816000000,
    );
    expect(Q.parse({ from: '2026-10-12T15:00:00Z' }).from?.toISOString()).toBe(
      '2026-10-12T15:00:00.000Z',
    );
  });

  it('thiếu hoặc rỗng → không lọc', () => {
    expect(Q.parse({}).from).toBeUndefined();
    expect(Q.parse({ from: '' }).from).toBeUndefined();
  });

  it('giá trị rác → ZodError (controller trả 400)', () => {
    expect(() => Q.parse({ from: 'hôm qua' })).toThrow(z.ZodError);
  });
});
