import type { TaskDataMessage } from '../../../tasks/application/task-protocol.js';
import { ArbitrageEvaluator } from '../../application/arbitrage-evaluator.js';
import { IngestTaskDataHandler } from '../../application/commands/ingest-task-data.command.js';
import { ReleaseTaskOddsHandler } from '../../application/commands/release-task-odds.command.js';
import { OddsLineApplier } from '../../application/odds-line-applier.js';
import { LaneDispatcher } from '../../application/lane-dispatcher.js';
import { TeamNameResolver } from '../../application/team-name.resolver.js';
import type { TeamAliasRepository } from '../../domain/team-alias.repository.js';
import type { TeamAlias } from '../../domain/team-alias.js';
import { MatchKey } from '../../domain/match-key.js';
import { InMemoryOddsRoomStore } from '../persistence/in-memory/in-memory-odds-room.store.js';
import { InMemorySignalStateStore } from '../persistence/in-memory/in-memory-signal-state.store.js';
import { InMemoryArbitrageSettingsStore } from '../settings/in-memory-arbitrage-settings.store.js';
import { InMemoryEventPublisher } from '../messaging/in-memory.event-publisher.js';
import { SptPubOddsTranslator } from '../acl/sptpub/sptpub-odds.translator.js';
import { PolymarketOddsTranslator } from '../acl/polymarket/polymarket-odds.translator.js';

const START = Date.parse('2026-09-25T09:00:00Z');

const aliasRepo = (aliases: TeamAlias[] = []): TeamAliasRepository => ({
  findAll: () => Promise.resolve({ status: 'SUCEED', data: aliases }),
  findById: () => Promise.resolve({ status: 'NOT_FOUND' }),
  save: (a) => Promise.resolve({ status: 'SUCEED', data: a }),
  delete: () => Promise.resolve({ status: 'SUCEED', data: true }),
});

let seq = 0;
const msg = (
  tenant: string,
  kind: string,
  payload: unknown,
): TaskDataMessage => ({
  taskId: `${tenant}-1`,
  tenant,
  kind,
  seq: ++seq,
  sentAt: START - 60_000,
  receivedAt: START - 60_000,
  payload,
});

// rút gọn từ HAR csgoempire (sptpub): Alliance (competitor1) vs Sinners Esports
const sptpubSnapshot = (k1: string, k2: string, b?: number) => ({
  version: 1,
  events: {
    '2710222376687251490': {
      desc: {
        scheduled: START / 1000,
        type: 'match',
        sport: '109',
        competitors: [
          { id: 'a', name: 'Alliance' },
          { id: 'b', name: 'Sinners Esports' },
        ],
      },
      markets: {
        '186': { '': { '4': { k: k1, ...(b ? { b } : {}) }, '5': { k: k2 } } },
      },
    },
  },
});

// rút gọn từ HAR polymarket, ở dạng đã chuẩn hóa của @polymarket/client
const polyEvents = [
  {
    id: '1009793',
    slug: 'cs2-all-sin2-2026-09-25',
    schedule: { startTime: '2026-09-25T09:10:00Z' },
    sports: { sport: { sport: 'cs2' } },
    markets: [
      {
        conditionId: '0xf6a4',
        slug: 'cs2-all-sin2-2026-09-25',
        state: { closed: false, acceptingOrders: true },
        outcomes: {
          yes: { label: 'Alliance', tokenId: 'tA' },
          no: { label: 'Sinners', tokenId: 'tS' },
        },
        prices: { bestBid: '0.45', bestAsk: '0.48' },
        sports: { sportsMarketType: 'moneyline', gameStartTime: null },
      },
    ],
  },
];

describe('luồng ingest → room → kèo (adapter in-memory)', () => {
  const setup = async () => {
    const teams = new TeamNameResolver(aliasRepo());
    await teams.reload();
    const rooms = new InMemoryOddsRoomStore();
    const publisher = new InMemoryEventPublisher();
    const events: { name: string }[] = [];
    publisher.on('*', (e: { name: string }) => events.push(e));
    const evaluator = new ArbitrageEvaluator(
      rooms,
      new InMemorySignalStateStore(),
      new InMemoryArbitrageSettingsStore(),
      publisher,
      () => START,
    );
    const translators = [
      new SptPubOddsTranslator(teams),
      new PolymarketOddsTranslator(teams),
    ];
    const lanes = new LaneDispatcher(new OddsLineApplier(rooms, evaluator));
    const ingest = new IngestTaskDataHandler(translators, lanes);
    const release = new ReleaseTaskOddsHandler(translators, lanes);
    return { ingest, release, rooms, events };
  };

  it('ghép sptpub + polymarket vào cùng room dù tên đội và giờ bắt đầu hơi lệch', async () => {
    const { ingest, rooms } = await setup();
    await ingest.execute(
      msg('sptpub', 'sptpub.live', sptpubSnapshot('1.35', '2.95')),
    );
    await ingest.execute(
      msg('polymarket', 'polymarket.descriptor', polyEvents),
    );

    const room = await rooms.get(
      MatchKey.of({
        sport: 'cs2',
        teamX: 'alliance',
        teamY: 'sinners',
        market: 'game-winner',
      }),
    );
    expect([...room.lines.keys()].sort()).toEqual(['polymarket', 'sptpub']);
  });

  it('phát kèo khi có lợi nhuận >= 2%, hủy khi một chân bị khóa', async () => {
    const { ingest, events } = await setup();
    // sinners @ sptpub 2.95, alliance @ poly 1/0.48 ≈ 2.083 → ≈ 22% lợi nhuận
    await ingest.execute(
      msg('sptpub', 'sptpub.live', sptpubSnapshot('1.35', '2.95')),
    );
    await ingest.execute(
      msg('polymarket', 'polymarket.descriptor', polyEvents),
    );
    expect(events.map((e) => e.name)).toContain('arbitrage.signal.issued');

    await ingest.execute(
      msg('sptpub', 'sptpub.live', sptpubSnapshot('0.0', '2.95', 1)),
    );
    expect(events.map((e) => e.name)).toContain('arbitrage.signal.cancelled');
  });

  it('kèo tăng >= 1% → phát kèo mới ghi đè kèo cũ, không gửi hủy', async () => {
    const { ingest, events } = await setup();
    await ingest.execute(
      msg('sptpub', 'sptpub.live', sptpubSnapshot('1.35', '2.95')),
    );
    await ingest.execute(
      msg('polymarket', 'polymarket.descriptor', polyEvents),
    );
    await ingest.execute(
      msg('sptpub', 'sptpub.live', sptpubSnapshot('1.35', '3.4')),
    );

    const issued = events.filter(
      (e) => e.name === 'arbitrage.signal.issued',
    ) as unknown as {
      signal: { signalId: string };
      supersedes: string | null;
    }[];
    expect(issued).toHaveLength(2);
    expect(issued[1].supersedes).toBe(issued[0].signal.signalId);
    expect(events.map((e) => e.name)).not.toContain(
      'arbitrage.signal.cancelled',
    );
  });

  it('publisher chết hẳn → gỡ odds của nó và hủy kèo dùng chân đó', async () => {
    const { ingest, release, events } = await setup();
    await ingest.execute(
      msg('sptpub', 'sptpub.live', sptpubSnapshot('1.35', '2.95')),
    );
    await ingest.execute(
      msg('polymarket', 'polymarket.descriptor', polyEvents),
    );
    expect(events.map((e) => e.name)).toContain('arbitrage.signal.issued');

    await release.execute({
      taskId: 'sptpub-1',
      kind: 'sptpub.live',
    });
    const cancelled = events.filter(
      (e) => e.name === 'arbitrage.signal.cancelled',
    ) as unknown as { reason: string }[];
    expect(cancelled.length).toBeGreaterThan(0);
    expect(cancelled.every((c) => c.reason === 'publisher_stopped')).toBe(true);
  });
});
