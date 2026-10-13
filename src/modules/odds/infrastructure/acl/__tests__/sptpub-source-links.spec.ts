import { SptPubSourceLinks } from '../sptpub/sptpub-source-links.js';

describe('SptPubSourceLinks', () => {
  const metadata = {
    sports: { '111': { slug: 'dota-2' } },
    categories: { c: { slug: 'dota-2' } },
    tournaments: { t: { slug: 'dreamleague-season-30-eeu-cq' } },
  };
  const desc = {
    slug: 'huligani-nemiga-gaming',
    sport: '111',
    category: 'c',
    tournament: 't',
  };

  it('reconstructs the supplied CSGOEmpire path without rounding the event id', () => {
    const links = new SptPubSourceLinks();
    links.update(metadata);
    const url = new URL(links.eventUrl('2721501408921788440', desc)!);
    expect(url.origin + url.pathname).toBe(
      'https://csgoempire.com/match-betting',
    );
    expect(url.searchParams.get('bt-path')).toBe(
      '/dota-2/dota-2/dreamleague-season-30-eeu-cq/huligani-nemiga-gaming-2721501408921788440',
    );
  });

  it('retains dictionaries across snapshot pages and deltas; handles removals', () => {
    const links = new SptPubSourceLinks();
    links.update({ sports: metadata.sports });
    expect(links.eventUrl('123', desc)).toBeNull();
    links.update({
      categories: metadata.categories,
      tournaments: metadata.tournaments,
    });
    links.update({ version: 10, events: {} });
    expect(links.eventUrl('123', desc)).not.toBeNull();
    links.update({ tournaments: { t: null } });
    expect(links.eventUrl('123', desc)).toBeNull();
  });

  it('does not guess paths when original slugs or metadata are missing', () => {
    const links = new SptPubSourceLinks();
    links.update(metadata);
    expect(links.eventUrl('123', { sport: '111', competitors: [] })).toBeNull();
    expect(links.eventUrl('123', { ...desc, category: 'unknown' })).toBeNull();
  });
});
