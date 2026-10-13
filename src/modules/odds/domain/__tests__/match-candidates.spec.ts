import {
  findMatchCandidates,
  nameSimilarity,
  type MatchSummary,
} from '../match-candidates.js';

const m = (
  teams: [string, string],
  tenants: string[],
  startsAt = 0,
  sport = 'cs2',
): MatchSummary => ({
  match: `${sport}:${[...teams].sort().join('~')}`,
  sport,
  teams: [...teams].sort() as [string, string],
  tenants,
  startsAt,
});

describe('nameSimilarity', () => {
  it('trùng = 1, tiền tố = 0.8, khác hẳn thấp', () => {
    expect(nameSimilarity('infurity', 'infurity')).toBe(1);
    expect(nameSimilarity('inf', 'infurity')).toBe(0.8);
    expect(nameSimilarity('alliance', 'sinners')).toBeLessThan(0.5);
  });
});

describe('findMatchCandidates', () => {
  const opts = { maxStartDriftMs: 20 * 60_000 };

  it('một đội trùng, đội kia là viết tắt → gợi ý bí danh tên ngắn → tên dài', () => {
    const [c] = findMatchCandidates(
      [
        m(['aaa', 'infurity'], ['sptpub'], 0),
        m(['aaa', 'inf'], ['polymarket'], 5 * 60_000),
      ],
      opts,
    );
    expect(c).toBeDefined();
    expect(c?.score).toBeCloseTo(0.9);
    expect(c?.aliases).toEqual([
      { alias: 'inf', canonical: 'infurity', similarity: 0.8 },
    ]);
  });

  it('bỏ qua: cùng tenant, lệch giờ quá ngưỡng, khác môn, không có đội nào gần trùng', () => {
    expect(
      findMatchCandidates(
        [m(['aaa', 'infurity'], ['sptpub']), m(['aaa', 'inf'], ['sptpub'])],
        opts,
      ),
    ).toEqual([]);
    expect(
      findMatchCandidates(
        [
          m(['aaa', 'infurity'], ['sptpub'], 0),
          m(['aaa', 'inf'], ['polymarket'], 30 * 60_000),
        ],
        opts,
      ),
    ).toEqual([]);
    expect(
      findMatchCandidates(
        [
          m(['aaa', 'infurity'], ['sptpub'], 0, 'cs2'),
          m(['aaa', 'inf'], ['polymarket'], 0, 'lol'),
        ],
        opts,
      ),
    ).toEqual([]);
    expect(
      findMatchCandidates(
        [
          m(['alliance', 'sinners'], ['sptpub']),
          m(['heroic', 'vitality'], ['polymarket']),
        ],
        opts,
      ),
    ).toEqual([]);
  });

  it('ghép chéo khi đội tương ứng nằm ở vị trí khác sau khi sắp alphabet', () => {
    // a: [nip, vitality]; b: [evitality, nip] → nip↔nip, vitality↔evitality
    const [c] = findMatchCandidates(
      [
        m(['nip', 'vitality'], ['sptpub']),
        m(['evitality', 'nip'], ['polymarket']),
      ],
      opts,
    );
    expect(c?.pairs).toEqual([
      ['nip', 'nip'],
      ['vitality', 'evitality'],
    ]);
    expect(c?.aliases.map((a) => [a.alias, a.canonical])).toEqual([
      ['vitality', 'evitality'],
    ]);
  });
});
