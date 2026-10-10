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
import { BackgroundQueue } from '../background-queue.js';
import type { HealthResult } from '../health.js';
import { IncidentTracker } from '../incident-tracker.js';
import {
  DEFAULT_WATCHDOG_OPTIONS,
  defaultStaleAfterMs,
  OpsWatchdog,
  type WatchedConsumer,
  type WatchedLane,
  type WatchedNode,
  type WatchedTask,
} from '../ops-watchdog.js';

const task = (p: Partial<WatchedTask> = {}): WatchedTask => ({
  taskId: 't1',
  kind: 'sptpub.live',
  state: 'RUNNING',
  consecutiveFailures: 0,
  lastDataAt: null,
  lastError: null,
  params: { intervalMs: 1_000 },
  ...p,
});

const setup = () => {
  let now = 100_000;
  const state = {
    tasks: [] as WatchedTask[],
    nodes: [] as WatchedNode[],
    consumers: [] as WatchedConsumer[],
    lanes: [] as WatchedLane[],
    health: [] as HealthResult[],
  };
  const tracker = new IncidentTracker(
    {
      save: () => Promise.resolve(),
      closeAllOpen: () => Promise.resolve(0),
      list: () => Promise.resolve([]),
    },
    { notify: () => Promise.resolve() },
    createBus(),
    new BackgroundQueue(),
    { renotifyCooldownMs: 0 },
    () => now,
  );
  const dog = new OpsWatchdog(
    {
      tasks: () => Promise.resolve(state.tasks),
      nodes: () => state.nodes,
      consumers: () => state.consumers,
      lanes: () => state.lanes,
      health: () => state.health,
    },
    tracker,
    DEFAULT_WATCHDOG_OPTIONS,
    () => now,
  );
  const keys = () => tracker.openKeys().sort();
  return {
    state,
    dog,
    keys,
    advance: (ms: number) => (now += ms),
    now: () => now,
  };
};

describe('OpsWatchdog', () => {
  it('ngưỡng im lặng: 5× chu kỳ poll (≥30s), stream 15 phút', () => {
    expect(defaultStaleAfterMs(task({ params: { intervalMs: 1_000 } }))).toBe(
      30_000,
    );
    expect(defaultStaleAfterMs(task({ params: { intervalMs: 30_000 } }))).toBe(
      150_000,
    );
    expect(
      defaultStaleAfterMs(task({ kind: 'polymarket.stream', params: {} })),
    ).toBe(900_000);
  });

  it('RUNNING mà không có dữ liệu quá ngưỡng → source.stale; có dữ liệu lại → hết', async () => {
    const w = setup();
    w.state.tasks = [task()];
    await w.dog.tick(); // bắt đầu đếm từ lúc thấy RUNNING
    w.advance(29_000);
    await w.dog.tick();
    expect(w.keys()).toEqual([]);
    w.advance(2_000);
    await w.dog.tick();
    expect(w.keys()).toEqual(['source.stale:t1']);

    w.state.tasks = [task({ lastDataAt: w.now() })];
    await w.dog.tick();
    expect(w.keys()).toEqual([]);
  });

  it('FAILED → task.failed; lỗi liên tiếp → task.flapping; xóa task → đóng hết', async () => {
    const w = setup();
    w.state.tasks = [
      task({ state: 'FAILED', consecutiveFailures: 6, lastError: 'boom' }),
    ];
    await w.dog.tick();
    expect(w.keys()).toEqual(['task.failed:t1']);

    w.state.tasks = [task({ state: 'RESTARTING', consecutiveFailures: 3 })];
    await w.dog.tick();
    expect(w.keys()).toEqual(['task.flapping:t1']);

    w.state.tasks = [];
    await w.dog.tick();
    expect(w.keys()).toEqual([]);
  });

  it('node rớt quá thời gian ân hạn → node.down; kết nối lại → hết', async () => {
    const w = setup();
    w.state.nodes = [
      { nodeId: 'n1', connected: false, disconnectedAt: w.now() },
    ];
    await w.dog.tick();
    expect(w.keys()).toEqual([]); // chớp mạng: chưa báo
    w.advance(16_000);
    await w.dog.tick();
    expect(w.keys()).toEqual(['node.down:n1']);
    w.state.nodes = [{ nodeId: 'n1', connected: true, disconnectedAt: null }];
    await w.dog.tick();
    expect(w.keys()).toEqual([]);
  });

  it('consumer mất kết nối / tồn đọng, lane dồn, hạ tầng lỗi', async () => {
    const w = setup();
    w.state.consumers = [
      { consumerId: 'bot', role: 'trader', connected: false, pending: 60 },
    ];
    w.state.lanes = [{ lane: 'sptpub:live', queued: 5_000 }];
    w.state.health = [
      {
        name: 'postgres',
        ok: false,
        latencyMs: 3_000,
        error: 'TIMEOUT',
        checkedAt: 0,
      },
      { name: 'dragonfly', ok: true, latencyMs: 1, error: null, checkedAt: 0 },
    ];
    await w.dog.tick();
    w.advance(31_000);
    await w.dog.tick();
    expect(w.keys()).toEqual([
      'consumer.backlog:bot',
      'consumer.down:bot',
      'infra.down:postgres',
      'lane.backlog:sptpub:live',
    ]);
  });
});
