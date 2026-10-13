// Tạo passwordHash cho WEB_USERS:  pnpm hash-password '<mật khẩu>'
import { randomBytes, scryptSync } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error("Cách dùng: pnpm hash-password '<mật khẩu>'");
  process.exit(1);
}
const N = 16384;
const salt = randomBytes(16);
const key = scryptSync(password, salt, 32, { N });
console.log(`scrypt$${N}$${salt.toString('base64')}$${key.toString('base64')}`);
