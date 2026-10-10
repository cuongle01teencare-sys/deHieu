import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import type { TransactionContext } from '../../../../../../shared/infrastructure/database/transaction-context.js';
import { TeamAlias } from '../../../../domain/team-alias.js';
import { DrizzleTeamAliasRepository } from '../drizzle-team-alias.repository.js';
import * as schema from '../drizzle-team-alias.schema.js';

describe('DrizzleTeamAliasRepository', () => {
  let client: PGlite;
  let repo: DrizzleTeamAliasRepository;

  beforeEach(async () => {
    client = new PGlite();
    const db = drizzle(client, { schema });
    await migrate(db, { migrationsFolder: './drizzle' });
    repo = new DrizzleTeamAliasRepository({
      executor: db,
    } as unknown as TransactionContext);
  });

  afterEach(async () => {
    await client.close();
  });

  it('lưu bí danh đã chuẩn hóa và đọc lại được', async () => {
    const saved = await repo.save(
      TeamAlias.create({
        id: 'a1',
        alias: 'NIP',
        canonical: 'Ninjas in Pyjamas',
      }),
    );
    expect(saved.status).toBe('SUCEED');

    const all = await repo.findAll();
    expect(all.status === 'SUCEED' && all.data.map((a) => a.props)).toEqual([
      expect.objectContaining({ alias: 'nip', canonical: 'ninjasinpyjamas' }),
    ]);
  });

  it('cùng alias thì cập nhật canonical, không tạo dòng mới', async () => {
    await repo.save(
      TeamAlias.create({
        id: 'a1',
        alias: 'NIP',
        canonical: 'Ninjas in Pyjamas',
      }),
    );
    await repo.save(
      TeamAlias.create({ id: 'a2', alias: 'nip', canonical: 'NIP Academy' }),
    );
    const all = await repo.findAll();
    expect(
      all.status === 'SUCEED' && all.data.map((a) => a.props.canonical),
    ).toEqual(['nipacademy']);
  });

  it('xóa theo id', async () => {
    await repo.save(
      TeamAlias.create({
        id: 'a1',
        alias: 'NIP',
        canonical: 'Ninjas in Pyjamas',
      }),
    );
    expect(await repo.delete('a1')).toEqual({ status: 'SUCEED', data: true });
    expect(await repo.delete('a1')).toEqual({ status: 'NOT_FOUND' });
  });
});
