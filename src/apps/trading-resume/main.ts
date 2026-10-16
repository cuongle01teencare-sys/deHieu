import {
  AccountLock,
  accountResource,
} from '../../shared/infrastructure/trading/account-lock.js';

const [venue, identity, reviewed] = process.argv.slice(2);
if (
  !['csgoempire', 'polymarket'].includes(venue) ||
  !identity ||
  reviewed !== '--reconciled'
)
  throw new Error(
    'Dùng sau khi đã đối soát lệnh trên sàn: pnpm trading:resume <csgoempire|polymarket> <hồ sơ|ví funder> --reconciled',
  );
if (!process.env.REDIS_URL) throw new Error('Thiếu REDIS_URL');
const locks = new AccountLock(process.env.REDIS_URL);
const resource = accountResource(
  venue,
  venue === 'polymarket' ? identity.toLowerCase() : identity,
);
try {
  await locks.with([resource], async () => {
    await locks.resume(resource);
  });
  console.log(
    'Đã gỡ trạng thái dừng cho tài khoản đã đối soát. App kiểm tra lại trong tối đa 30 giây.',
  );
} finally {
  locks.close();
}
