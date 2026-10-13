import { z } from 'zod';

const Slugs = z.record(
  z.string(),
  z.looseObject({ slug: z.string().nullish() }).nullable(),
);
const Metadata = z.object({
  sports: Slugs.optional(),
  categories: Slugs.optional(),
  tournaments: Slugs.optional(),
});
const EventPath = z.object({
  slug: z.string().min(1),
  sport: z.string(),
  category: z.string(),
  tournament: z.string(),
});

/** Original slugs from CSGOEmpire's feed; never use normalized team aliases. */
export class SptPubSourceLinks {
  private readonly _sports = new Map<string, string>();
  private readonly _categories = new Map<string, string>();
  private readonly _tournaments = new Map<string, string>();

  update(payload: unknown): void {
    const result = Metadata.safeParse(payload);
    if (!result.success) return;
    for (const [records, index] of [
      [result.data.sports, this._sports],
      [result.data.categories, this._categories],
      [result.data.tournaments, this._tournaments],
    ] as const) {
      for (const [id, value] of Object.entries(records ?? {})) {
        if (value?.slug) index.set(id, value.slug);
        else index.delete(id);
      }
    }
  }

  eventUrl(eventId: string, description: unknown): string | null {
    const result = EventPath.safeParse(description);
    if (!result.success) return null;
    const event = result.data;
    const parts = [
      this._sports.get(event.sport),
      this._categories.get(event.category),
      this._tournaments.get(event.tournament),
      `${event.slug}-${eventId}`,
    ];
    if (parts.some((part) => !part)) return null;
    const url = new URL('https://csgoempire.com/match-betting');
    url.searchParams.set(
      'bt-path',
      `/${parts.map((part) => encodeURIComponent(part!)).join('/')}`,
    );
    return url.href;
  }
}
