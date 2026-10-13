import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { TransactionContext } from '../../../../shared/infrastructure/database/transaction-context.js';
import type { Incident } from '../../domain/incident.js';
import { DrizzleAuditRepository } from '../persistence/drizzle/drizzle-audit.repository.js';
import { DrizzleIncidentRepository } from '../persistence/drizzle/drizzle-incident.repository.js';
import { DrizzleOddsTransitionRepository } from '../persistence/drizzle/drizzle-odds-transition.repository.js';

const incident = (p: Partial<Incident> = {}): Incident => ({
  id: '00000000-0000-4000-8000-000000000001',
  key: 'node.down:n1',
  kind: 'node.down',
  severity: 'critical',
  title: 'Node mất kết nối: n1',
  message: '20s',
  details: { nodeId: 'n1' },
  openedAt: 1_000,
  lastSeenAt: 1_000,
  resolvedAt: null,
  resolution: null,
  acknowledgedAt: null,
  acknowledgedBy: null,
  ...p,
});

describe('Repository của admin (PGlite + migration thật)', () => {
  let tx: TransactionContext;

  beforeEach(async () => {
    const db = drizzle(new PGlite());
    await migrate(db, { migrationsFolder: './drizzle' });
    tx = { executor: db } as unknown as TransactionContext;
  });

  it('sự cố: lưu, cập nhật (upsert), lọc đang mở, đóng hết khi khởi động lại', async () => {
    const repo = new DrizzleIncidentRepository(tx);
    await repo.save(incident());
    await repo.save(
      incident({ acknowledgedAt: 2_000, acknowledgedBy: 'alice' }),
    );
    await repo.save(
      incident({
        id: '00000000-0000-4000-8000-000000000002',
        key: 'infra.down:postgres',
        kind: 'infra.down',
        resolvedAt: 3_000,
        resolution: 'recovered',
      }),
    );
    const open = await repo.list({ open: true, limit: 10, offset: 0 });
    expect(open).toHaveLength(1);
    expect(open[0]).toMatchObject({
      key: 'node.down:n1',
      acknowledgedBy: 'alice',
    });
    expect(await repo.closeAllOpen(9_000, 'app_restart')).toBe(1);
    expect(await repo.list({ open: true, limit: 10, offset: 0 })).toHaveLength(
      0,
    );
    const all = await repo.list({ limit: 10, offset: 0 });
    expect(all.map((i) => i.resolution).sort()).toEqual([
      'app_restart',
      'recovered',
    ]);
  });

  it('audit: ghi và lọc', async () => {
    const repo = new DrizzleAuditRepository(tx);
    const base = {
      roles: ['admin'],
      params: {},
      body: { minMargin: 0.03 },
      ok: true,
      status: 200,
      error: null,
      durationMs: 3,
    };
    await repo.insert({
      ...base,
      id: '00000000-0000-4000-8000-0000000000a1',
      at: 1_000,
      principalId: 'alice',
      method: 'PATCH',
      route: '/arbitrage/settings',
      path: '/arbitrage/settings',
    });
    await repo.insert({
      ...base,
      id: '00000000-0000-4000-8000-0000000000a2',
      at: 2_000,
      principalId: 'bob',
      method: 'POST',
      route: '/tasks/:taskId/stop',
      path: '/tasks/x/stop',
    });
    expect(
      (await repo.list({ limit: 10, offset: 0 })).map((e) => e.principalId),
    ).toEqual(['bob', 'alice']);
    expect(
      await repo.list({ route: 'tasks', limit: 10, offset: 0 }),
    ).toHaveLength(1);
    const [alice] = await repo.list({
      principalId: 'alice',
      limit: 10,
      offset: 0,
    });
    expect(alice?.body).toEqual({ minMargin: 0.03 });
  });

  it('chuyển trạng thái odds: ghi lô, lọc theo room, dọn bản ghi cũ', async () => {
    const repo = new DrizzleOddsTransitionRepository(tx);
    const room = 'room:cs2:a~b:game-winner';
    await repo.insertMany([
      {
        at: 1_000,
        room,
        tenant: 'sptpub',
        phase: 'live',
        from: null,
        to: 'open',
        reason: null,
      },
      {
        at: 2_000,
        room,
        tenant: 'sptpub',
        phase: 'live',
        from: 'open',
        to: 'removed',
        reason: 'publisher_stopped',
      },
      {
        at: 3_000,
        room: 'room:cs2:c~d:game-winner',
        tenant: 'polymarket',
        phase: 'prematch',
        from: null,
        to: 'open',
        reason: null,
      },
    ]);
    const rows = await repo.list({ room, limit: 10, offset: 0 });
    expect(rows.map((r) => r.to)).toEqual(['removed', 'open']);
    expect(await repo.deleteOlderThan(new Date(2_500))).toBe(2);
    expect(await repo.list({ limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('giữ lại: chỉ xóa sự cố ĐÃ ĐÓNG quá hạn, theo lô', async () => {
    const repo = new DrizzleIncidentRepository(tx);
    const id = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
    await repo.save(incident({ id: id(1), resolvedAt: 1_000 }));
    await repo.save(incident({ id: id(2), resolvedAt: 2_000 }));
    await repo.save(incident({ id: id(3), resolvedAt: 9_000 })); // còn hạn
    await repo.save(incident({ id: id(4), resolvedAt: null })); // đang mở
    const before = new Date(5_000);
    expect(await repo.purgeOlderThan(before, 1)).toBe(1);
    expect(await repo.purgeOlderThan(before, 10)).toBe(1);
    expect(await repo.purgeOlderThan(before, 10)).toBe(0);
    const left = await repo.list({ limit: 10, offset: 0 });
    expect(left.map((x) => x.id).sort()).toEqual([id(3), id(4)]);
  });

  it('giữ lại: xóa audit quá hạn theo lô', async () => {
    const repo = new DrizzleAuditRepository(tx);
    for (const [n, at] of [
      [1, 1_000],
      [2, 2_000],
      [3, 9_000],
    ] as const)
      await repo.insert({
        id: `00000000-0000-4000-8000-0000000002${n}0`,
        at,
        principalId: 'alice',
        roles: ['admin'],
        method: 'POST',
        route: '/tasks',
        path: '/tasks',
        params: {},
        body: null,
        ok: true,
        status: 201,
        error: null,
        durationMs: 1,
      });
    expect(await repo.purgeOlderThan(new Date(5_000), 10)).toBe(2);
    expect(await repo.list({ limit: 10, offset: 0 })).toHaveLength(1);
  });

  it('đếm: cùng bộ lọc với list, bỏ qua limit/offset', async () => {
    const repo = new DrizzleAuditRepository(tx);
    for (const [n, at, who] of [
      [1, 1_000, 'alice'],
      [2, 2_000, 'alice'],
      [3, 3_000, 'bob'],
    ] as const)
      await repo.insert({
        id: `00000000-0000-4000-8000-0000000003${n}0`,
        at,
        principalId: who,
        roles: ['admin'],
        method: 'POST',
        route: '/tasks',
        path: '/tasks',
        params: {},
        body: null,
        ok: true,
        status: 201,
        error: null,
        durationMs: 1,
      });
    const q = { principalId: 'alice', limit: 1, offset: 0 };
    expect(await repo.list(q)).toHaveLength(1);
    expect(await repo.count(q)).toBe(2);
    expect(
      await repo.count({ from: new Date(2_500), limit: 1, offset: 0 }),
    ).toBe(1);

    const incidents = new DrizzleIncidentRepository(tx);
    await incidents.save(incident());
    expect(await incidents.count({ open: true, limit: 1, offset: 0 })).toBe(1);
    expect(await incidents.count({ open: false, limit: 1, offset: 0 })).toBe(0);

    const transitions = new DrizzleOddsTransitionRepository(tx);
    expect(await transitions.count({ limit: 1, offset: 0 })).toBe(0);
  });
});
