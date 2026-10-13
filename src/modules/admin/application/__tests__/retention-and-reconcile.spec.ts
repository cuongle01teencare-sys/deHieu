import { RetentionJob } from '../retention-job.js';
import { ReconcileIncidentRelay } from '../reconcile-incident.relay.js';
import type { IncidentTracker } from '../incident-tracker.js';
import { InMemoryOpsEventBus } from '../../../../shared/infrastructure/ops/in-memory-ops-event-bus.js';

describe('RetentionJob', () => {
  it('xóa theo lô tới khi hết, dừng ở giới hạn lô, một bảng lỗi không chặn bảng khác', async () => {
    let left = 12;
    const calls: number[] = [];
    const job = new RetentionJob(
      [
        {
          name: 'a',
          retentionDays: 1,
          purge: (before, limit) => {
            calls.push(before.getTime());
            const n = Math.min(left, limit);
            left -= n;
            return Promise.resolve(n);
          },
        },
        {
          name: 'b',
          retentionDays: 2,
          purge: () => Promise.reject(new Error('db down')),
        },
        { name: 'c', retentionDays: 3, purge: () => Promise.resolve(100) },
      ],
      { batchSize: 5, maxBatches: 3 },
      () => 10 * 86_400_000,
    );
    const r = await job.run();
    expect(r?.targets).toEqual([
      expect.objectContaining({
        name: 'a',
        deleted: 12,
        incomplete: false,
        error: null,
      }),
      expect.objectContaining({ name: 'b', deleted: 0, error: 'db down' }),
      // c luôn trả đủ lô → chạm maxBatches
      expect.objectContaining({ name: 'c', deleted: 300, incomplete: true }),
    ]);
    expect(calls[0]).toBe(9 * 86_400_000); // mốc = now - 1 ngày
    expect(job.last()).toBe(r);
    expect(job.policy()).toEqual([
      { name: 'a', retentionDays: 1 },
      { name: 'b', retentionDays: 2 },
      { name: 'c', retentionDays: 3 },
    ]);
  });
});

describe('ReconcileIncidentRelay', () => {
  it('vòng bất thường → mở sự cố; vòng bình thường → đóng', () => {
    const bus = new InMemoryOpsEventBus();
    const raised: string[] = [];
    const cleared: string[] = [];
    const tracker = {
      raise: (k: string) => raised.push(k),
      clear: (k: string) => cleared.push(k),
    } as unknown as IncidentTracker;
    const stop = new ReconcileIncidentRelay(bus, tracker).start();
    const report = (massive: boolean) =>
      bus.publish({
        type: 'odds.reconciled',
        topic: 'odds',
        at: 1,
        data: {
          tenant: 'polymarket',
          taskId: 'poly-events',
          known: 100,
          seen: massive ? 50 : 100,
          pending: 0,
          removed: 0,
          held: massive ? 50 : 0,
          ratio: massive ? 0.5 : 0,
          massive,
        },
      });
    report(true);
    report(false);
    stop();
    report(true);
    expect(raised).toEqual(['odds.mass_removal:polymarket:poly-events']);
    expect(cleared).toEqual(['odds.mass_removal:polymarket:poly-events']);
  });
});
