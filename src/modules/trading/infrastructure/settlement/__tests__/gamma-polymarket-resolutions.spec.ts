import { describe, expect, it, vi } from 'vitest';
import {
  GammaPolymarketResolutions,
  resolvedPrices,
} from '../gamma-polymarket-resolutions.js';

describe('kết quả market Polymarket (gamma)', () => {
  it('gamma: chỉ nhận market đã đóng VÀ đã resolve', () => {
    const m = {
      closed: true,
      clobTokenIds: '["x","y"]',
      outcomePrices: '["1","0"]',
      umaResolutionStatus: 'resolved',
    };
    expect([...resolvedPrices(m)]).toEqual([
      ['x', 1],
      ['y', 0],
    ]);
    expect(resolvedPrices({ ...m, closed: false }).size).toBe(0);
    expect(resolvedPrices({ ...m, umaResolutionStatus: 'disputed' }).size).toBe(
      0,
    );
    expect(
      resolvedPrices({
        ...m,
        umaResolutionStatus: undefined,
        outcomePrices: '["0.9995","0.0005"]',
      }).size,
    ).toBe(0);
  });
  it('hỏi theo lô token, chỉ trả token được hỏi', async () => {
    const fetcher = vi.fn((url: string) => {
      void url;
      return Promise.resolve(
        Response.json([
          {
            closed: true,
            clobTokenIds: '["x","y"]',
            outcomePrices: '["0","1"]',
            umaResolutionStatus: 'resolved',
          },
        ]),
      );
    });
    const r = await new GammaPolymarketResolutions(
      'https://gamma.test',
      fetcher as unknown as typeof fetch,
    ).resolve(['x']);
    expect([...r]).toEqual([['x', 0]]);
    expect(fetcher.mock.calls[0][0]).toBe(
      'https://gamma.test/markets?clob_token_ids=x&closed=true&limit=2',
    );
  });
});
