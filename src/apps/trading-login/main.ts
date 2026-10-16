import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  AccountLock,
  accountResource,
} from '../../shared/infrastructure/trading/account-lock.js';
import {
  launchProfile,
  loginReady,
  SESSION_EXPIRED,
} from '../../shared/infrastructure/trading/empire-session.js';

const name = process.argv[2];
const port = Number(process.env.TRADING_DEBUG_PORT ?? '9222');
if (!name || !Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error('Dùng: pnpm trading:login <hồ sơ> [--har=path.har]');
if (!process.env.REDIS_URL) throw new Error('Thiếu REDIS_URL');
const locks = new AccountLock(process.env.REDIS_URL);
try {
  await locks.with([accountResource('csgoempire', name)], async (check) => {
    const context = await launchProfile(name, {
      login: true,
      port,
      har: process.argv.find((a) => a.startsWith('--har='))?.slice(6),
    });
    const reader = createInterface({ input: stdin, output: stdout });
    try {
      console.log(
        `Trên máy cá nhân chạy: ssh -N -L ${port}:127.0.0.1:${port} <user>@<server>`,
      );
      console.log(
        `Mở chrome://inspect/#devices, thêm localhost:${port}, chọn Inspect và đăng nhập trên tab của server.`,
      );
      const page = context.pages()[0] ?? (await context.newPage());
      let authenticated = false;
      page.on('response', (response) => {
        if (
          !response
            .url()
            .startsWith(
              'https://csgoempire.com/api/v2/match-betting/betby/user-session/',
            )
        )
          return;
        void response
          .json()
          .then((v: { success?: boolean; data?: { token?: string } }) => {
            authenticated =
              response.ok() && v.success === true && !!v.data?.token;
          })
          .catch(() => undefined);
      });
      await page.goto('https://csgoempire.com/match-betting', {
        waitUntil: 'domcontentloaded',
      });
      await reader.question(
        'Đăng nhập xong, mở Match betting. Nhấn Enter ở đây để lưu phiên và đóng Chromium. ',
      );
      await check();
      if (!authenticated)
        throw new Error(
          'Chưa thấy phiên BetBy hợp lệ; đăng nhập lại và mở Match betting.',
        );
      await context.close();
      await loginReady(name);
      await locks.clearHalt(
        [accountResource('csgoempire', name)],
        SESSION_EXPIRED,
      );
      console.log('Đã lưu phiên. App kiểm tra lại trong tối đa 30 giây.');
    } finally {
      reader.close();
      await context.close();
    }
  });
} finally {
  locks.close();
}
