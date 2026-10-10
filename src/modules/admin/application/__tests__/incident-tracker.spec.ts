import type {
  OpsEvent,
  OpsEventBus,
} from '../../../../shared/application/ops-event-bus.js';

/** Bus tối giản cho test (không phụ thuộc lớp infrastructure). */
const createBus = (): OpsEventBus & { events: OpsEvent[] } => {
  const listeners: ((e: OpsEvent) => void)[] = [];
  const events: OpsEvent[] = [];
  return {
    events,
    publish: (e) => {
      events.push(e);
      listeners.forEach((l) => l(e));
    },
    subscribe: (l) => {
      listeners.push(l);
      return () => undefined;
    },
  };
};
import type { Incident } from '../../domain/incident.js';
import type { AlertNotifier } from '../alert-notifier.js';
import { BackgroundQueue } from '../background-queue.js';
import type { IncidentRepository } from '../incident.repository.js';
import { IncidentTracker } from '../incident-tracker.js';

const setup = () => {
  let now = 1_000;
  const saved: Incident[] = [];
  const repo: IncidentRepository = {
    save: (i) => {
      saved.push(i);
      return Promise.resolve();
    },
    closeAllOpen: () => Promise.resolve(0),
    list: () => Promise.resolve([]),
  };
  const notified: [string, string][] = [];
  const notifier: AlertNotifier = {
    notify: (change, i) => {
      notified.push([change, i.key]);
      return Promise.resolve();
    },
  };
  const bus = createBus();
  const events = bus.events;
  const queue = new BackgroundQueue((e) => {
    throw e;
  });
  const tracker = new IncidentTracker(
    repo,
    notifier,
    bus,
    queue,
    { renotifyCooldownMs: 60_000 },
    () => now,
  );
  return {
    tracker,
    saved,
    notified,
    events,
    queue,
    advance: (ms: number) => (now += ms),
  };
};

const sig = {
  kind: 'source.stale',
  severity: 'critical' as const,
  title: 'Nguồn im lặng',
  message: '40s',
};

describe('IncidentTracker', () => {
  it('raise lặp lại chỉ mở một sự cố, báo một lần; clear báo hết', async () => {
    const t = setup();
    t.tracker.raise('source.stale:a', sig);
    t.tracker.raise('source.stale:a', sig);
    t.tracker.raise('source.stale:a', sig);
    expect(t.tracker.open()).toHaveLength(1);
    expect(t.notified).toEqual([['opened', 'source.stale:a']]);

    t.advance(5_000);
    t.tracker.clear('source.stale:a');
    t.tracker.clear('source.stale:a'); // không có gì để đóng
    await t.queue.flush();

    expect(t.tracker.open()).toHaveLength(0);
    expect(t.notified).toEqual([
      ['opened', 'source.stale:a'],
      ['resolved', 'source.stale:a'],
    ]);
    expect(t.events.map((e) => e.type)).toEqual([
      'incident.opened',
      'incident.resolved',
    ]);
    // ghi DB: lúc mở + lúc đóng (không ghi mỗi lần raise lặp)
    expect(t.saved).toHaveLength(2);
    expect(t.saved[1]?.resolvedAt).toBe(6_000);
  });

  it('mở lại trong thời gian cooldown → ghi nhận nhưng không báo lại', () => {
    const t = setup();
    t.tracker.raise('k', sig);
    t.tracker.clear('k');
    t.advance(10_000);
    t.tracker.raise('k', sig); // chập chờn
    t.tracker.clear('k');
    expect(t.notified).toEqual([
      ['opened', 'k'],
      ['resolved', 'k'],
    ]);
    t.advance(60_000);
    t.tracker.raise('k', sig); // hết cooldown → báo lại
    expect(t.notified.at(-1)).toEqual(['opened', 'k']);
  });

  it('đổi mức độ / nội dung thì cập nhật DB, không mở sự cố mới', async () => {
    const t = setup();
    t.tracker.raise('k', sig);
    t.tracker.raise('k', { ...sig, message: '90s' });
    await t.queue.flush();
    expect(t.tracker.open()[0]?.message).toBe('90s');
    expect(t.saved).toHaveLength(2);
    expect(t.notified).toHaveLength(1);
  });

  it('acknowledge ghi người xác nhận, sự cố vẫn mở', () => {
    const t = setup();
    t.tracker.raise('k', sig);
    expect(t.tracker.acknowledge('k', 'alice')?.acknowledgedBy).toBe('alice');
    expect(t.tracker.isOpen('k')).toBe(true);
    expect(t.tracker.acknowledge('khong-co', 'alice')).toBeNull();
  });
});
