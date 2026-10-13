import { WebSocket } from 'ws';
import { InMemoryOpsEventBus } from '../../../../shared/infrastructure/ops/in-memory-ops-event-bus.js';
import type { Authenticator } from '../../../auth/application/authenticator.js';
import type { AuthorizationService } from '../../../auth/application/authorization.service.js';
import { WsTicketService } from '../../../auth/application/ws-ticket.service.js';
import type { AdminServerFrame } from '../../application/admin-stream-protocol.js';
import type { MetricsSampler } from '../../application/metrics-sampler.js';
import type { GetAdminSnapshotHandler } from '../../application/queries/get-admin-snapshot.query.js';
import { AdminWsHub } from '../stream/admin-ws-hub.js';

const auth: Authenticator = { authenticate: () => Promise.resolve(null) };
const authz = {
  can: (p: { roles: readonly string[] }) =>
    Promise.resolve(p.roles.includes('admin')),
} as unknown as AuthorizationService;

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

describe('AdminWsHub — vé một lần + topic trận', () => {
  let hub: AdminWsHub;
  let bus: InMemoryOpsEventBus;
  let tickets: WsTicketService;

  beforeEach(() => {
    bus = new InMemoryOpsEventBus();
    tickets = new WsTicketService();
    hub = new AdminWsHub(
      { port: 0, metricsIntervalMs: 10_000 },
      bus,
      auth,
      authz,
      {
        execute: () => Promise.resolve({ at: 1, incidents: [] }),
      } as unknown as GetAdminSnapshotHandler,
      { sample: () => Promise.resolve({ at: 2 }) } as unknown as MetricsSampler,
      (room) => Promise.resolve({ room }),
      () => undefined,
      {
        match: (id) => Promise.resolve({ match: id, markets: [] }),
        matchOfRoom: (r) =>
          /^room:([^:]+):([^:]+):[^:]+$/.exec(r)?.slice(1, 3).join(':') ?? null,
        redeemTicket: (t) => tickets.redeem(t),
      },
    );
    hub.listen();
  });
  afterEach(() => hub.close());

  it('hello bằng vé → welcome; vé chỉ dùng được một lần', async () => {
    const { ticket } = tickets.issue({ id: 'alice', roles: ['admin'] });
    const a = connect(hub.port());
    await a.opened;
    a.send({ type: 'hello', ticket, topics: [] });
    await a.until(() => a.frames.some((f) => f.type === 'welcome'));
    a.ws.close();

    const b = connect(hub.port());
    await b.opened;
    b.send({ type: 'hello', ticket, topics: [] });
    await b.closed;
    expect(b.frames[0]).toEqual({ type: 'rejected', reason: 'UNAUTHORIZED' });
  });

  it('subscribe match → ảnh chụp trận, rồi odds.changed của mọi room thuộc trận', async () => {
    const { ticket } = tickets.issue({ id: 'alice', roles: ['admin'] });
    const c = connect(hub.port());
    await c.opened;
    c.send({ type: 'hello', ticket, topics: ['match:cs2:a~b'] });
    await c.until(() => c.frames.some((f) => f.type === 'match'));
    expect(c.frames.find((f) => f.type === 'match')).toMatchObject({
      match: 'cs2:a~b',
    });

    const changed = (room: string) =>
      bus.publish({
        type: 'odds.changed',
        topic: `room:${room}`,
        at: 1,
        data: { room, tenant: 'sptpub', phase: 'live', removed: false },
      });
    changed('room:cs2:a~b:map-1-winner');
    changed('room:cs2:a~c:game-winner'); // trận khác → không nhận
    changed('room:cs2:a~b:total-maps-2.5');
    await c.until(() => c.frames.filter((f) => f.type === 'event').length >= 2);
    await new Promise((r) => setTimeout(r, 50));
    const rooms = c.frames
      .filter((f) => f.type === 'event')
      .map((f) => (f.type === 'event' ? f.event.topic : ''));
    expect(rooms).toEqual([
      'room:room:cs2:a~b:map-1-winner',
      'room:room:cs2:a~b:total-maps-2.5',
    ]);
    c.ws.close();
  });
});
