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
});
