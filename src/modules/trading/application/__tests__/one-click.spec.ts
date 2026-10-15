import { describe, expect, it } from 'vitest';
import { OneClickBoard } from '../one-click-board.js';
import { OneClickAdmin } from '../one-click-admin.js';
import type { TraderConfigSync } from '../trader-config.sync.js';

const candidate = (signalId: string) => ({
  id: `p1:${signalId}`,
  profileId: 'p1',
  mode: 'paper',
  signalId,
  room: 'room:cs2:a~b:game-winner',
  sport: 'cs2',
  market: 'game-winner',
  teams: ['a', 'b'],
  phase: 'prematch',
  comboId: 'sptpub>0|polymarket>1',
  status: 'paper_filled',
  reason: 'ONE_CLICK: giá bán thấp nhất 0.62 ≥ 0.5',
  signalMargin: 0.04,
  tierName: 'VIP',
  book: null,
  polymarket: null,
  totalCost: 48,
  payout: 50,
  profit: 2,
  netMargin: 0.04,
  latencyMs: 3,
  detail: {},
  createdAt: 0,
});

describe('On click', () => {
  it('bảng: thêm/cập nhật theo kèo, gỡ khi removed, bỏ kèo hết hạn', () => {
    let now = 1_000;
    const b = new OneClickBoard(() => now);
    b.apply({
      profileId: 'p1',
      signalId: 's1',
      expiresAt: 5_000,
      candidate: candidate('s1'),
    });
    now = 2_000;
    b.apply({
      profileId: 'p1',
      signalId: 's2',
      expiresAt: 3_000,
      candidate: candidate('s2'),
    });
    expect(b.list('p1').map((c) => c.signalId)).toEqual(['s2', 's1']);
    expect(b.list('p2')).toEqual([]);
    now = 3_500; // s2 hết hạn
    expect(b.list('p1').map((c) => c.signalId)).toEqual(['s1']);
    b.apply({ profileId: 'p1', signalId: 's1', removed: true });
    expect(b.list('p1')).toEqual([]);
    expect(() => b.apply({ profileId: 'p1' })).toThrow();
  });

  it('bảng trả sự kiện cho lịch sử: lên bảng, rời bảng kèm lý do / người bấm, hết hạn (sweep)', () => {
    let now = 1_000;
    const b = new OneClickBoard(() => now);
    expect(
      b.apply({
        profileId: 'p1',
        signalId: 's1',
        expiresAt: 5_000,
        candidate: candidate('s1'),
      }),
    ).toMatchObject({ type: 'upsert', candidate: { signalId: 's1' } });
    b.apply({
      profileId: 'p1',
      signalId: 's2',
      expiresAt: 2_000,
      candidate: candidate('s2'),
    });
    expect(
      b.apply({
        profileId: 'p1',
        signalId: 's1',
        removed: true,
        reason: 'manual:paper_filled',
        by: 'admin',
      }),
    ).toEqual({
      type: 'end',
      profileId: 'p1',
      signalId: 's1',
      reason: 'manual:paper_filled',
      by: 'admin',
      at: 1_000,
    });
    now = 2_500;
    expect(b.sweep()).toEqual([
      {
        type: 'end',
        profileId: 'p1',
        signalId: 's2',
        reason: 'expired',
        by: null,
        at: 2_500,
      },
    ]);
    expect(b.sweep()).toEqual([]);
  });

  it('vào lệnh: gửi manual_enter cho trader của profile kèm người bấm; lỗi rõ ràng', async () => {
    const b = new OneClickBoard(() => 1_000);
    b.apply({
      profileId: 'p1',
      signalId: 's1',
      expiresAt: 5_000,
      candidate: candidate('s1'),
    });
    const sent: unknown[] = [];
    let reply: 'SENT' | 'NO_TASK' | 'REJECTED' = 'SENT';
    const sync = {
      sendToProfile: (profileId: string, name: string, data: unknown) => {
        sent.push({ profileId, name, data });
        return Promise.resolve(reply);
      },
    } as unknown as TraderConfigSync;
    const admin = new OneClickAdmin(b, sync);
    expect(await admin.enter('p1', 's1', 'alice')).toEqual({
      status: 'SUCEED',
      data: { sent: true },
    });
    expect(sent).toEqual([
      {
        profileId: 'p1',
        name: 'manual_enter',
        data: { signalId: 's1', by: 'alice' },
      },
    ]);
    expect((await admin.enter('p1', 'khong-co', 'alice')).status).toBe(
      'NOT_FOUND',
    );
    reply = 'NO_TASK';
    expect(await admin.enter('p1', 's1', 'alice')).toMatchObject({
      status: 'FAILED',
    });
  });
});
