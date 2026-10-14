import { describe, expect, it } from 'vitest';
import { TraderDataHandler } from '../trader-data.handler.js';
import type { TradeAttempt } from '../trade-attempt.js';
import type { TradeAttemptRepository } from '../trading.ports.js';
import type { TraderConfigSync } from '../trader-config.sync.js';

const payload = {
  id: 'p:s',
  profileId: 'p',
  mode: 'paper',
  signalId: 's',
  room: 'room:lol:a~b:match-winner',
  sport: 'lol',
  market: 'match-winner',
  teams: ['a', 'b'],
  phase: 'live',
  comboId: 'x',
  status: 'skipped',
  reason: 'NO_EDGE: x',
  signalMargin: 0.03,
  tierName: null,
  book: null,
  polymarket: null,
  totalCost: 0,
  payout: 0,
  profit: 0,
  netMargin: 0,
  latencyMs: 5,
  createdAt: Date.now(),
};

describe('TraderDataHandler', () => {
  it('database lỗi tạm thời → thử lại tới khi ghi được', async () => {
    let calls = 0;
    const saved: TradeAttempt[] = [];
    const repo = {
      record: (t: TradeAttempt) => {
        if (++calls < 3) return Promise.reject(new Error('db down'));
        saved.push(t);
        return Promise.resolve();
      },
    } as unknown as TradeAttemptRepository;
    const h = new TraderDataHandler(repo, {} as TraderConfigSync, {
      attempts: 5,
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    await h.execute({
      taskId: 't',
      kind: 'trader.arbitrage',
      channel: 'trade',
      payload,
    });
    expect(calls).toBe(3);
    expect(saved[0]).toMatchObject({ id: 'p:s', legs: [], timing: null });
  });

  it('hết số lần thử → ném lỗi (log ở module)', async () => {
    const repo = {
      record: () => Promise.reject(new Error('db down')),
    } as unknown as TradeAttemptRepository;
    const h = new TraderDataHandler(repo, {} as TraderConfigSync, {
      attempts: 2,
      baseDelayMs: 1,
      sleep: () => Promise.resolve(),
    });
    await expect(
      h.execute({
        taskId: 't',
        kind: 'trader.arbitrage',
        channel: 'trade',
        payload,
      }),
    ).rejects.toThrow('db down');
  });
});
