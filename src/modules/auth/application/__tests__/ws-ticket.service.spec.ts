import { WsTicketService } from '../ws-ticket.service.js';

describe('WsTicketService', () => {
  it('vé dùng một lần, hết hạn thì vô hiệu', () => {
    let now = 1_000;
    const s = new WsTicketService(60_000, () => now);
    const p = { id: 'alice', roles: ['admin'] };

    const a = s.issue(p);
    expect(a.expiresAt).toBe(61_000);
    expect(s.redeem(a.ticket)).toEqual(p);
    expect(s.redeem(a.ticket)).toBeNull();

    const b = s.issue(p);
    now = 61_000;
    expect(s.redeem(b.ticket)).toBeNull();
    expect(s.redeem('không-có')).toBeNull();
  });
});
