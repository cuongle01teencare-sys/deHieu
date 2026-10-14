import { MatchKey } from '../match-key.js';
import { OddsLine } from '../odds-line.js';
import { OddsRoom } from '../odds-room.js';
import type { Phase } from '../phase.js';
import { decideSignals, type ComboSignalState } from '../signal-policy.js';

const key = MatchKey.of({
  sport: 'cs2',
  teamX: 'sinners',
  teamY: 'alliance',
  market: 'game-winner',
});
const settings = {
  minMargin: 0.02,
  marginStep: 0.01,
  marginDropStep: 0.01,
  signalTtlMs: 30_000,
  enabledPhases: ['live', 'prematch'] as Phase[],
};
const line = (
  tenant: string,
  a: number,
  b: number,
  opts: {
    status?: 'open' | 'suspended';
    phase?: Phase;
    startsAt?: number;
  } = {},
) =>
  OddsLine.create({
    tenant,
    odds: [a, b],
    status: opts.status ?? 'open',
    phase: opts.phase ?? 'prematch',
    updatedAt: 0,
    startsAt: opts.startsAt ?? 0,
    ref: {},
  });
const room = (...lines: OddsLine[]) =>
  new OddsRoom(key, new Map(lines.map((l) => [l.props.tenant, l])));
const noExplain = () => 'leg_removed' as const;

describe('OddsRoom', () => {
  it('ghép chéo hai chiều giữa các tenant, không ghép cùng tenant', () => {
    const combos = room(
      line('sptpub', 2.2, 1.8),
      line('poly', 1.7, 2.3),
    ).combinations(0);
    expect(combos.map((c) => c.comboId).sort()).toEqual([
      'poly>0|sptpub>1',
      'sptpub>0|poly>1',
    ]);
    const best = combos.find((c) => c.comboId === 'sptpub>0|poly>1');
    expect(best?.margin).toBeCloseTo(1 / (1 / 2.2 + 1 / 2.3) - 1, 10);
  });

  it('kèo có một chân live thì phase = live', () => {
    const [c] = room(
      line('sptpub', 2.2, 1.8, { phase: 'live' }),
      line('poly', 1.7, 2.3),
    ).combinations(0);
    expect(c?.phase).toBe('live');
  });

  it('explainMissing nêu đúng lý do', () => {
    const id = 'sptpub>0|poly>1';
    expect(room(line('poly', 1.7, 2.3)).explainMissing(id, 0)).toBe(
      'leg_removed',
    );
    expect(
      room(line('poly', 1.7, 2.3)).explainMissing(id, 0, 'publisher_stopped'),
    ).toBe('publisher_stopped');
    expect(
      room(
        line('sptpub', 2, 2, { status: 'suspended' }),
        line('poly', 2, 2),
      ).explainMissing(id, 0),
    ).toBe('leg_suspended');
    expect(
      room(
        line('sptpub', 2, 2, { startsAt: 0 }),
        line('poly', 2, 2, { startsAt: 60_000 }),
      ).explainMissing(id, 1_000),
    ).toBe('start_time_mismatch');
  });
});

describe('decideSignals', () => {
  const combo = (a: number, b: number, phase: Phase = 'prematch') =>
    room(line('sptpub', a, 1.01, { phase }), line('poly', 1.01, b))
      .combinations(0)
      .filter((c) => c.comboId === 'sptpub>0|poly>1');
  const state = (margin: number, at = 0): Map<string, ComboSignalState> =>
    new Map([
      [
        'sptpub>0|poly>1',
        {
          comboId: 'sptpub>0|poly>1',
          issuedMargin: margin,
          lastIssuedAt: at,
          signalId: 's1',
        },
      ],
    ]);

  it('phát kèo khi lần đầu đạt ngưỡng', () => {
    expect(
      decideSignals(new Map(), combo(2.2, 2.2), 0, settings, noExplain)[0]
        ?.type,
    ).toBe('issue');
  });

  it('không phát khi dưới ngưỡng', () => {
    expect(
      decideSignals(new Map(), combo(2.02, 2.02), 0, settings, noExplain),
    ).toEqual([]);
  });

  it('tăng thêm >= 1% → hủy kèo cũ vì có kèo tốt hơn rồi phát mới', () => {
    const d = decideSignals(
      state(0.03),
      combo(2.1, 2.1),
      1_000,
      settings,
      noExplain,
    );
    expect(d).toEqual([
      expect.objectContaining({
        type: 'cancel',
        signalId: 's1',
        reason: 'better_opportunity',
      }),
      expect.objectContaining({ type: 'issue' }),
    ]);
  });

  it('giảm chưa đủ bước → không gửi gì', () => {
    expect(
      decideSignals(state(0.05), combo(2.09, 2.09), 1_000, settings, noExplain),
    ).toEqual([]);
  });

  it.each([
    [0.05, 0.09, 'better_opportunity'],
    [0.09, 0.05, 'margin_decreased'],
    [0.09, 0.08, 'margin_decreased'],
    [0.08, 0.09, 'better_opportunity'],
  ])('margin %s → %s: hủy trước, phát một kèo mới (%s)', (from, to, reason) => {
    const odds = 2 * (1 + to);
    const d = decideSignals(
      state(from),
      combo(odds, odds),
      1_000,
      settings,
      noExplain,
    );
    expect(d).toHaveLength(2);
    expect(d[0]).toMatchObject({ type: 'cancel', signalId: 's1', reason });
    expect(d[1]).toMatchObject({ type: 'issue' });
    if (d[1].type === 'issue')
      expect(d[1].opportunity.margin).toBeCloseTo(to, 12);
  });

  it('bước tăng và bước giảm được cấu hình độc lập', () => {
    const separate = { ...settings, marginStep: 0.02, marginDropStep: 0.005 };
    expect(
      decideSignals(state(0.09), combo(2.2, 2.2), 1_000, separate, noExplain),
    ).toEqual([]);
    expect(
      decideSignals(state(0.09), combo(2.17, 2.17), 1_000, separate, noExplain),
    ).toEqual([
      expect.objectContaining({ type: 'cancel', reason: 'margin_decreased' }),
      expect.objectContaining({ type: 'issue' }),
    ]);
  });

  it('thay đổi đủ bước được ưu tiên hơn refresh', () => {
    expect(
      decideSignals(
        state(0.09),
        combo(2.16, 2.16),
        30_000,
        settings,
        noExplain,
      ),
    ).toEqual([
      expect.objectContaining({ type: 'cancel', reason: 'margin_decreased' }),
      expect.objectContaining({ type: 'issue' }),
    ]);
  });

  it('tụt dưới ngưỡng → hủy (below_threshold)', () => {
    expect(
      decideSignals(state(0.05), combo(2.02, 2.02), 1_000, settings, noExplain),
    ).toEqual([
      expect.objectContaining({
        type: 'cancel',
        reason: 'below_threshold',
        signalId: 's1',
      }),
    ]);
  });

  it('tổ hợp biến mất → hủy với lý do do explainMissing đưa ra', () => {
    expect(
      decideSignals(state(0.05), [], 1_000, settings, () => 'leg_suspended')[0],
    ).toMatchObject({
      type: 'cancel',
      reason: 'leg_suspended',
    });
  });

  it('kênh bị tắt → hủy kèo đang sống (phase_disabled) và không phát kèo mới', () => {
    const prematchOnly = {
      ...settings,
      enabledPhases: ['prematch'] as Phase[],
    };
    expect(
      decideSignals(
        state(0.1),
        combo(2.2, 2.2, 'live'),
        1_000,
        prematchOnly,
        noExplain,
      )[0],
    ).toMatchObject({
      type: 'cancel',
      reason: 'phase_disabled',
    });
    expect(
      decideSignals(
        new Map(),
        combo(2.2, 2.2, 'live'),
        0,
        prematchOnly,
        noExplain,
      ),
    ).toEqual([]);
  });

  it('còn nguyên sau 30s → phát lại', () => {
    expect(
      decideSignals(
        state(0.1, 0),
        combo(2.2, 2.2),
        30_000,
        settings,
        noExplain,
      )[0],
    ).toMatchObject({
      type: 'refresh',
      signalId: 's1',
    });
  });
});
