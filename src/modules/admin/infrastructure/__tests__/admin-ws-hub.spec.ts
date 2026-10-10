import { WebSocket } from 'ws';
import { InMemoryOpsEventBus } from '../../../../shared/infrastructure/ops/in-memory-ops-event-bus.js';
import type { Authenticator } from '../../../auth/application/authenticator.js';
import type { AuthorizationService } from '../../../auth/application/authorization.service.js';
import type { AdminServerFrame } from '../../application/admin-stream-protocol.js';
import type { MetricsSampler } from '../../application/metrics-sampler.js';
import type { GetAdminSnapshotHandler } from '../../application/queries/get-admin-snapshot.query.js';
import { AdminWsHub } from '../stream/admin-ws-hub.js';

const auth: Authenticator = {
  authenticate: ({ authorization }) =>
    Promise.resolve(
      authorization === 'Bearer admin-token'
        ? { id: 'alice', roles: ['admin'] }
        : authorization === 'Bearer staff-token'
          ? { id: 'sam', roles: ['staff'] }
          : null,
    ),
};
const authz = {
  can: (p: { roles: readonly string[] }) =>
    Promise.resolve(p.roles.includes('admin')),
} as unknown as AuthorizationService;

/** Mở kết nối, gom mọi frame nhận được. */
const connect = (port: number) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const frames: AdminServerFrame[] = [];
  ws.on('message', (raw) =>
    frames.push(
      JSON.parse((raw as Buffer).toString('utf8')) as AdminServerFrame,
    ),
  );
  const opened = new Promise<void>((r) => ws.once('open', () => r()));
  const closed = new Promise<void>((r) => ws.once('close', () => r()));
  const until = async (pred: () => boolean, ms = 2_000) => {
    const end = Date.now() + ms;
    while (!pred()) {
      if (Date.now() > end)
        throw new Error(`timeout; frames=${JSON.stringify(frames)}`);
      await new Promise((r) => setTimeout(r, 10));
    }
  };
  return {
    ws,
    frames,
    opened,
    closed,
    until,
    send: (f: unknown) => ws.send(JSON.stringify(f)),
  };
};

describe('AdminWsHub', () => {
  let hub: AdminWsHub;
  let bus: InMemoryOpsEventBus;

  beforeEach(() => {
    bus = new InMemoryOpsEventBus();
    hub = new AdminWsHub(
      { port: 0, metricsIntervalMs: 50 },
      bus,
      auth,
      authz,
      {
        execute: () => Promise.resolve({ at: 1, incidents: [] }),
      } as unknown as GetAdminSnapshotHandler,
      { sample: () => Promise.resolve({ at: 2 }) } as unknown as MetricsSampler,
      (room) => Promise.resolve({ room, lines: {} }),
    );
    hub.listen();
  });
  afterEach(() => hub.close());

  it('sai token → rejected rồi đóng', async () => {
    const c = connect(hub.port());
    await c.opened;
    c.send({ type: 'hello', token: 'nope' });
    await c.closed;
    expect(c.frames[0]).toEqual({ type: 'rejected', reason: 'UNAUTHORIZED' });
  });

  it('thiếu quyền admin:read → rejected', async () => {
    const c = connect(hub.port());
    await c.opened;
    c.send({ type: 'hello', token: 'staff-token' });
    await c.closed;
    expect(c.frames[0]?.type).toBe('rejected');
  });

  it('welcome + snapshot, chỉ nhận sự kiện của topic đã subscribe, metrics định kỳ', async () => {
    const c = connect(hub.port());
    await c.opened;
    c.send({
      type: 'hello',
      token: 'admin-token',
      topics: ['alerts', 'metrics'],
    });
    await c.until(() => c.frames.some((f) => f.type === 'snapshot'));
    expect(c.frames[0]).toMatchObject({
      type: 'welcome',
      principal: { id: 'alice' },
    });

    bus.publish({
      type: 'node.connected',
      topic: 'nodes',
      at: 1,
      data: { nodeId: 'n1' },
    });
    bus.publish({
      type: 'incident.opened',
      topic: 'alerts',
      at: 2,
      data: {
        key: 'k',
        kind: 'node.down',
        severity: 'critical',
        title: 't',
        message: 'm',
      },
    });
    await c.until(() => c.frames.some((f) => f.type === 'event'));
    await c.until(() => c.frames.some((f) => f.type === 'metrics'));
    const events = c.frames.filter((f) => f.type === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: { type: 'incident.opened' } });
    c.ws.close();
  });

  it('subscribe room → nhận ảnh chụp room rồi odds.changed của đúng room đó', async () => {
    const c = connect(hub.port());
    await c.opened;
    c.send({ type: 'hello', token: 'admin-token', topics: [] });
    await c.until(() => c.frames.some((f) => f.type === 'snapshot'));
    c.send({
      type: 'subscribe',
      topics: ['room:room:cs2:a~b:game-winner', 'bogus'],
    });
    await c.until(() => c.frames.some((f) => f.type === 'room'));
    expect(c.frames.some((f) => f.type === 'error')).toBe(true); // 'bogus' bị từ chối

    const changed = (room: string) => ({
      type: 'odds.changed' as const,
      topic: `room:${room}`,
      at: 3,
      data: { room, tenant: 'sptpub', phase: 'live', removed: false },
    });
    bus.publish(changed('room:cs2:x~y:game-winner'));
    bus.publish(changed('room:cs2:a~b:game-winner'));
    await c.until(() => c.frames.some((f) => f.type === 'event'));
    const events = c.frames.filter((f) => f.type === 'event');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: { data: { room: 'room:cs2:a~b:game-winner' } },
    });
    c.ws.close();
  });
});
