import { redact } from '../audit.interceptor.js';

describe('redact', () => {
  it('che mọi trường nhạy cảm, kể cả lồng nhau', () => {
    expect(
      redact({
        name: 'x',
        token: 'abc',
        nested: { apiSecret: 's', list: [{ password: 'p', ok: 1 }] },
        webhookUrl: 'https://discord.com/api/webhooks/1/2',
      }),
    ).toEqual({
      name: 'x',
      token: '***',
      nested: { apiSecret: '***', list: [{ password: '***', ok: 1 }] },
      webhookUrl: '***',
    });
  });
});
