import { createPublicClient, production } from '@polymarket/client';
import {
  PolymarketEventSchema,
  PolymarketMarketSchema,
  PolymarketStreamEventSchema,
} from '../src/modules/odds/infrastructure/acl/polymarket/polymarket.dto.js';

const tagId = Number(process.argv[2] ?? 100639);
const durationMs = Number(process.argv[3] ?? 15_000);
if (
  !Number.isInteger(tagId) ||
  tagId <= 0 ||
  !Number.isFinite(durationMs) ||
  durationMs <= 0
)
  throw new Error(
    'Usage: pnpm exec tsx scripts/diagnose-polymarket-ingest.ts [tagId] [durationMs]',
  );

const deadline = setTimeout(() => {
  console.error('Diagnostic timed out');
  process.exit(1);
}, durationMs + 30_000);
const client = createPublicClient({ environment: production });

try {
  const counts = { events: 0, eventFailures: 0, markets: 0, marketFailures: 0 };
  const samples = new Map<string, unknown>();
  const assets: string[] = [];
  for await (const page of client.listEvents({
    tagIds: [tagId],
    closed: false,
    ended: false,
    order: 'volume24hr',
    ascending: false,
    pageSize: 100,
  })) {
    for (const raw of page.items) {
      counts.events++;
      const ev = PolymarketEventSchema.safeParse(raw);
      if (!ev.success) {
        counts.eventFailures++;
        if (!samples.has('event'))
          samples.set('event', { id: raw.id, issues: ev.error.issues });
      }
      for (const market of raw.markets ?? []) {
        counts.markets++;
        const parsed = PolymarketMarketSchema.safeParse(market);
        if (!parsed.success) {
          counts.marketFailures++;
          if (!samples.has('market'))
            samples.set('market', {
              id: market.id,
              issues: parsed.error.issues,
            });
        }
        if (
          ['cs2', 'lol', 'dota2', 'val'].includes(raw.sports?.sport?.sport ?? '') &&
          !market.state.closed &&
          market.state.acceptingOrders !== false
        ) {
          for (const outcome of [market.outcomes.yes, market.outcomes.no])
            if (outcome.tokenId && assets.length < 20)
              assets.push(outcome.tokenId);
        }
      }
    }
    break;
  }
  console.log('Descriptor:', JSON.stringify(counts));
  console.log(
    'Descriptor failures:',
    JSON.stringify(Object.fromEntries(samples), null, 2),
  );
  if (!assets.length) {
    console.log('No active CS2/LoL tokens found in the first page');
  } else {
    const handle = await client.subscribe([
      {
        topic: 'market',
        assetIds: [...new Set(assets)],
        customFeatureEnabled: true,
      },
    ]);
    const stop = setTimeout(() => {
      void handle.close();
    }, durationMs);
    const byType: Record<string, { received: number; parseFailed: number }> =
      {};
    const streamFailures = new Map<string, unknown>();
    try {
      for await (const event of handle) {
        const c = (byType[event.type] ??= { received: 0, parseFailed: 0 });
        c.received++;
        const parsed = PolymarketStreamEventSchema.safeParse(event);
        if (!parsed.success) {
          c.parseFailed++;
          if (!streamFailures.has(event.type))
            streamFailures.set(event.type, {
              payload: event.payload,
              issues: parsed.error.issues,
            });
        }
      }
    } finally {
      clearTimeout(stop);
      await handle.close();
    }
    console.log('Stream:', JSON.stringify(byType, null, 2));
    console.log(
      'Stream failures:',
      JSON.stringify(Object.fromEntries(streamFailures), null, 2),
    );
  }
} finally {
  clearTimeout(deadline);
  await client.closeSubscriptions();
}
