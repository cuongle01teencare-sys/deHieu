/**
 * Phát hiện "ghép trượt": hai trận do hai nhóm tenant khác nhau báo về, nhiều khả năng là
 * CÙNG một trận nhưng tên đội lệch (vd "inf" ↔ "infurity") nên rơi vào hai room khác nhau.
 * Thuần tính toán, không phụ thuộc hạ tầng.
 */

export interface MatchSummary {
  /** Id trận: 'cs2:alliance~sinners'. */
  readonly match: string;
  readonly sport: string;
  readonly teams: readonly [string, string];
  readonly tenants: readonly string[];
  readonly startsAt: number;
}

export interface AliasSuggestion {
  /** Tên sẽ được quy về `canonical` (POST /team-aliases). */
  readonly alias: string;
  readonly canonical: string;
  readonly similarity: number;
}

export interface MatchCandidate {
  /** 0..1 — trung bình độ giống của hai cặp đội. */
  readonly score: number;
  readonly startsDiffMs: number;
  readonly a: MatchSummary;
  readonly b: MatchSummary;
  /** Cặp đội tương ứng [đội của a, đội của b]. */
  readonly pairs: readonly [
    readonly [string, string],
    readonly [string, string],
  ];
  /** Bí danh cần thêm để hai trận về chung room (cặp nào trùng hẳn thì không cần). */
  readonly aliases: readonly AliasSuggestion[];
}

export interface CandidateOptions {
  readonly maxStartDriftMs: number;
  /** Ngưỡng score tối thiểu. Mặc định 0.6. */
  readonly minScore?: number;
}

/** Độ giống hai tên đã chuẩn hóa: 1 = trùng; tiền tố ("inf" ⊂ "infurity") = 0.8; còn lại theo Levenshtein. */
export const nameSimilarity = (x: string, y: string): number => {
  if (x === y) return 1;
  if (!x || !y) return 0;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 2 && long.startsWith(short)) return 0.8;
  return 1 - levenshtein(x, y) / long.length;
};

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    prev = cur;
  }
  return prev[b.length];
}

const STRONG = 0.8;

export function findMatchCandidates(
  matches: readonly MatchSummary[],
  opts: CandidateOptions,
): MatchCandidate[] {
  const minScore = opts.minScore ?? 0.6;
  const sorted = [...matches].sort(
    (x, y) => x.sport.localeCompare(y.sport) || x.startsAt - y.startsAt,
  );
  const out: MatchCandidate[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j];
      if (b.sport !== a.sport) break;
      const drift = b.startsAt - a.startsAt;
      if (drift > opts.maxStartDriftMs) break; // đã sắp theo giờ → các trận sau còn xa hơn
      // cùng một tenant báo cả hai → nhiều khả năng là hai trận khác nhau thật
      if (a.tenants.some((t) => b.tenants.includes(t))) continue;

      const straight = [
        nameSimilarity(a.teams[0], b.teams[0]),
        nameSimilarity(a.teams[1], b.teams[1]),
      ];
      const crossed = [
        nameSimilarity(a.teams[0], b.teams[1]),
        nameSimilarity(a.teams[1], b.teams[0]),
      ];
      const useCross = crossed[0] + crossed[1] > straight[0] + straight[1];
      const sims = useCross ? crossed : straight;
      const bTeams = useCross
        ? [b.teams[1], b.teams[0]]
        : [b.teams[0], b.teams[1]];
      const score = (sims[0] + sims[1]) / 2;
      // phải có ít nhất một đội gần như chắc chắn trùng, tránh ghép bừa hai trận cùng giờ
      if (score < minScore || Math.max(...sims) < STRONG) continue;

      const pairs = [
        [a.teams[0], bTeams[0]],
        [a.teams[1], bTeams[1]],
      ] as const;
      out.push({
        score,
        startsDiffMs: drift,
        a,
        b,
        pairs,
        aliases: pairs
          .map(([x, y], k) => ({ x, y, sim: sims[k] }))
          .filter((p) => p.sim < 1)
          .map(({ x, y, sim }) => {
            // tên ngắn hơn thường là viết tắt → quy về tên dài
            const [alias, canonical] = x.length <= y.length ? [x, y] : [y, x];
            return { alias, canonical, similarity: sim };
          }),
      });
    }
  }
  return out.sort(
    (x, y) => y.score - x.score || x.startsDiffMs - y.startsDiffMs,
  );
}
