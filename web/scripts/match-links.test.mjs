import assert from 'node:assert/strict';
import test from 'node:test';
import {
  matchHref,
  roomHref,
  matchPhases,
  tenantHref,
  matchSources,
  decodePathSegment,
} from '../lib/match-links.ts';

test('match and room URLs preserve reserved characters and deep-link to a market', () => {
  const match = 'cs2:100%team~đội / b';
  const href = matchHref(match, 'map-1-winner');
  const url = new URL(href, 'https://console.example.com');
  assert.equal(
    decodeURIComponent(url.pathname.slice('/tran-dau/'.length)),
    match,
  );
  assert.equal(url.searchParams.get('market'), 'map-1-winner');
  assert.equal(roomHref(`room:${match}:map-1-winner`), href);
  assert.equal(roomHref('invalid-room'), null);
});

test('encoded route parameters decode once without crashing on literal percent signs', () => {
  assert.equal(decodePathSegment('cs2%3Aa~b'), 'cs2:a~b');
  assert.equal(decodePathSegment('cs2%3A100%25team~b'), 'cs2:100%team~b');
  assert.equal(decodePathSegment('cs2:100%team~b'), 'cs2:100%team~b');
  assert.equal(decodePathSegment('cs2%3Ateam%2520name~b'), 'cs2:team%20name~b');
});

test('detail phases come from lines even though the API has no top-level phases', () => {
  const markets = [
    { lines: { a: { phase: 'live' }, b: { phase: 'prematch' } } },
    { lines: { a: { phase: 'live' } } },
  ];
  assert.deepEqual(matchPhases(markets), ['live', 'prematch']);
  assert.deepEqual(matchPhases([]), []);
});

test('only absolute HTTP(S) source URLs without embedded credentials are clickable', () => {
  assert.equal(
    tenantHref({ url: 'https://polymarket.com/event/cs2-match' }),
    'https://polymarket.com/event/cs2-match',
  );
  for (const url of [
    'javascript:alert(1)',
    'data:text/html,hello',
    '/event/match',
    'https://user:secret@example.com/',
  ]) {
    assert.equal(tenantHref({ url }), null);
  }
  assert.equal(tenantHref({ e: '2721501408921788440' }), null);
  assert.equal(tenantHref({ slug: 'a-market-not-an-event' }), null);
});

test('source links are deduplicated across markets without mixing tenants', () => {
  const ref = { url: 'https://polymarket.com/event/cs2-match' };
  const markets = [
    { lines: { polymarket: { ref }, sptpub: { ref: { e: '123' } } } },
    { lines: { polymarket: { ref } } },
  ];
  assert.deepEqual(matchSources(markets), [
    { tenant: 'polymarket', href: ref.url },
  ]);
});
