import { describe, expect, it } from 'vitest';
import { PurgeHistoryHandler } from '../commands/purge-history.command.js';
import type { AuditRepository } from '../audit.repository.js';
import type { OddsTransitionRepository } from '../odds-transition.repository.js';

const DAY = 86_400_000;
const NOW = 100 * DAY;

/** Bản ghi giả theo mốc thời gian (ms). */
const fakes = (auditAt: number[], oddsAt: number[]) => {
  let audit = [...auditAt];
  let odds = [...oddsAt];
  const auditRepo = {
    count: (q: { to?: Date }) =>
      Promise.resolve(audit.filter((x) => !q.to || x <= q.to.getTime()).length),
    purgeOlderThan: (before: Date, limit: number) => {
      const hit = audit.filter((x) => x < before.getTime()).slice(0, limit);
      audit = audit.filter((x) => !hit.includes(x));
      return Promise.resolve(hit.length);
    },
  } as unknown as AuditRepository;
  const oddsRepo = {
    count: (q: { until?: Date }) =>
      Promise.resolve(
        odds.filter((x) => !q.until || x <= q.until.getTime()).length,
      ),
    deleteOlderThan: (before: Date) => {
      const n = odds.filter((x) => x < before.getTime()).length;
      odds = odds.filter((x) => x >= before.getTime());
      return Promise.resolve(n);
    },
  } as unknown as OddsTransitionRepository;
  return {
    h: new PurgeHistoryHandler(auditRepo, oddsRepo, () => NOW),
    left: () => ({ audit, odds }),
  };
};

describe('PurgeHistoryHandler', () => {
  it('bắt buộc chọn olderThanDays hoặc all; không cho cả hai; ngày phải ≥ 1', async () => {
    const { h } = fakes([], []);
    for (const c of [
      {},
      { all: true, olderThanDays: 7 },
      { olderThanDays: 0 },
      { olderThanDays: 1.5 },
    ])
      expect(await h.execute({ target: 'audit', ...c })).toMatchObject({
        status: 'FAILED',
      });
  });

  it('audit cũ hơn 30 ngày / 7 ngày; dryRun chỉ đếm', async () => {
    const { h, left } = fakes(
      [NOW - 40 * DAY, NOW - 31 * DAY, NOW - 10 * DAY, NOW - DAY],
      [],
    );
    expect(
      await h.execute({ target: 'audit', olderThanDays: 30, dryRun: true }),
    ).toMatchObject({ data: { matched: 2, deleted: 0 } });
    expect(left().audit).toHaveLength(4);
    expect(
      await h.execute({ target: 'audit', olderThanDays: 30 }),
    ).toMatchObject({
      data: { matched: 2, deleted: 2, before: NOW - 30 * DAY },
    });
    expect(
      await h.execute({ target: 'audit', olderThanDays: 7 }),
    ).toMatchObject({ data: { deleted: 1 } });
    expect(left().audit).toEqual([NOW - DAY]);
  });

  it('lịch sử odds: xóa hết, không đụng audit', async () => {
    const { h, left } = fakes([NOW - DAY], [NOW - 8 * DAY, NOW - 60_000, NOW]);
    expect(
      await h.execute({ target: 'odds-transitions', all: true }),
    ).toMatchObject({ data: { matched: 3, deleted: 3 } });
    expect(left()).toEqual({ audit: [NOW - DAY], odds: [] });
  });
});
