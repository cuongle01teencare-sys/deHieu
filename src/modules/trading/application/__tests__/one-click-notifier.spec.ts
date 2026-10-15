import { describe, expect, it } from 'vitest';
import { OneClickNotifier, type PushMessage } from '../one-click-notifier.js';
import { isNewOnBoard } from '../one-click-history.js';
import { OneClickBoard, type OneClickCandidate } from '../one-click-board.js';
import {
  OneClickHistoryRecorder,
  type OneClickPrior,
} from '../one-click-history.js';
import { TraderDataHandler } from '../trader-data.handler.js';
import type { TradeAttemptRepository } from '../trading.ports.js';
import type { TraderConfigSync } from '../trader-config.sync.js';

const cand = (): OneClickCandidate => ({
  profileId: 'p1',
  signalId: 'sig-1',
  expiresAt: 301_000,
  updatedAt: 1_000,
  analysis: {
    id: 'p1:sig-1',
    profileId: 'p1',
    mode: 'paper',
    signalId: 'sig-1',
    room: 'room:cs2:a~b:game-winner',
    sport: 'cs2',
    market: 'game-winner',
    teams: ['bushido', 'johnny'],
    phase: 'prematch',
    comboId: 'sptpub>0|polymarket>1',
    status: 'paper_filled',
    reason: 'ONE_CLICK',
    signalMargin: 0.0491,
    tierName: 'Phổ thông',
    book: {
      tenant: 'sptpub',
      side: 0,
      pick: 'bushido',
      odds: 2.48,
      stake: 35,
      url: null,
      startsAt: null,
      tournament: { name: 'iem', no: 8, of: 12 },
    },
    polymarket: null,
    totalCost: 70,
    payout: 72,
    profit: 2,
    netMargin: 0.0285,
    latencyMs: 3,
    detail: { minAsk: 0.55 },
    createdAt: 1_000,
    csgoempireAccountId: null,
    polymarketAccountId: null,
    timing: null,
    legs: [],
  },
});

describe('Thông báo On click', () => {
  it('chỉ báo khi kèo vừa lên bảng (mới / quay lại), không báo khi làm mới hay mở lại do app khởi động lại', () => {
    expect(isNewOnBoard({ state: 'none' })).toBe(true);
    expect(isNewOnBoard({ state: 'open' })).toBe(false);
    expect(
      isNewOnBoard({ state: 'ended', reason: 'result:skipped:NO_EDGE' }),
    ).toBe(true);
    expect(isNewOnBoard({ state: 'ended', reason: 'app_restart' })).toBe(false);
  });

  it('nội dung: trận, margin, giá bán thấp nhất, lãi dự kiến, thứ tự trong giải, profile; mở trang On click', async () => {
    const sent: PushMessage[] = [];
    const n = new OneClickNotifier(
      {
        send: (m) => (sent.push(m), Promise.resolve({ id: 'n1', errors: [] })),
      },
      () => Promise.resolve('Profile Test'),
      'https://arbops.example.com/',
      () => 1_000,
    );
    await n.entered(cand());
    expect(sent[0]).toMatchObject({
      title: 'On click: bushido vs johnny',
      url: 'https://arbops.example.com/on-click',
      collapseId: 'oneclick:sig-1',
      ttlSec: 300,
    });
    expect(sent[0]?.body).toContain('4.91% · Phổ thông');
    expect(sent[0]?.body).toContain('Giá bán thấp nhất 0.55');
    expect(sent[0]?.body).toContain('csgoempire 8/12');
    expect(sent[0]?.body).toContain('Profile Test');
    // gửi thử: chỉ thiết bị đang bấm, mở trang Thông báo
    expect(await n.test('admin', 'sub-1')).toEqual({ id: 'n1', errors: [] });
    expect(sent[1]).toMatchObject({
      title: 'Arb Ops: thông báo thử',
      subscriptionIds: ['sub-1'],
      url: 'https://arbops.example.com/thong-bao',
    });
    expect(sent[1]?.body).toContain('bởi admin');
    expect(
      await new OneClickNotifier(null, () => Promise.resolve(null), null).test(
        'a',
      ),
    ).toBeNull();
    // chưa cấu hình OneSignal → không gửi, không lỗi
    await new OneClickNotifier(null, () => Promise.resolve(null), null).entered(
      cand(),
    );
  });

  it('luồng dữ liệu trader: báo một lần khi kèo lên bảng, làm mới không báo; lỗi gửi không chặn', async () => {
    const priors: OneClickPrior[] = [{ state: 'none' }, { state: 'open' }];
    const history = new OneClickHistoryRecorder({
      upsert: () => Promise.resolve(priors.shift() ?? { state: 'open' }),
      end: () => Promise.resolve(),
      endAllOpen: () => Promise.resolve(0),
      list: () => Promise.resolve({ total: 0, items: [] }),
    });
    const sent: string[] = [];
    const errors: unknown[] = [];
    const notifier = new OneClickNotifier(
      {
        send: (m) => (
          sent.push(m.title),
          Promise.reject(new Error('mạng lỗi'))
        ),
      },
      () => Promise.resolve(null),
      null,
    );
    const h = new TraderDataHandler(
      {} as TradeAttemptRepository,
      {} as TraderConfigSync,
      undefined,
      new OneClickBoard(() => 1_000),
      history,
      notifier,
      (e) => errors.push(e),
    );
    const c = cand();
    const msg = {
      taskId: 't',
      kind: 'trader.arbitrage',
      channel: 'oneclick',
      payload: {
        profileId: 'p1',
        signalId: 'sig-1',
        expiresAt: 301_000,
        candidate: c.analysis,
      },
    };
    await h.execute(msg);
    await h.execute(msg); // làm mới
    await new Promise((r) => setTimeout(r, 10));
    expect(sent).toEqual(['On click: bushido vs johnny']);
    expect(errors).toHaveLength(1);
  });
});
