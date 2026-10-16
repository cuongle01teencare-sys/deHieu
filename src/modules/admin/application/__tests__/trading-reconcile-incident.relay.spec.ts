import { describe, expect, it, vi } from 'vitest';
import { InMemoryOpsEventBus } from '../../../../shared/infrastructure/ops/in-memory-ops-event-bus.js';
import { TradingReconcileIncidentRelay } from '../trading-reconcile-incident.relay.js';
import type { IncidentTracker } from '../incident-tracker.js';

describe('sự cố "cần đối soát lệnh thật"', () => {
  it('mở sự cố nghiêm trọng theo profile; gỡ khóa thì đóng', () => {
    const ops = new InMemoryOpsEventBus();
    const incidents = { raise: vi.fn(), clear: vi.fn() };
    new TradingReconcileIncidentRelay(
      ops,
      incidents as unknown as IncidentTracker,
    ).start();
    ops.publish({
      type: 'trading.reconcile_required',
      topic: 'alerts',
      at: 1,
      data: {
        profileId: 'p1',
        profileName: 'test',
        tradeId: 't1',
        summary: 'csgoempire: không vào · Polymarket: khớp 20 share, 8.50$',
      },
    });
    const [key, sig] = incidents.raise.mock.calls[0] as [
      string,
      { kind: string; severity: string; message: string },
    ];
    expect(key).toBe('trading.reconcile:p1');
    expect(sig).toMatchObject({
      kind: 'trading.reconcile',
      severity: 'critical',
    });
    expect(sig.message).toContain('Polymarket: khớp 20 share');
    ops.publish({
      type: 'trading.reconciled',
      topic: 'alerts',
      at: 2,
      data: { profileId: 'p1', cleared: 2 },
    });
    expect(incidents.clear).toHaveBeenCalledWith('trading.reconcile:p1');
  });
});
