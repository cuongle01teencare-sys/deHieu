import { randomBytes, scryptSync } from 'node:crypto';
import { writeFile, access, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const secret = () => randomBytes(32).toString('hex');

export function buildEnv({ apiHost, username, passwordHash, databaseUrl }) {
  let database;
  try {
    if (typeof databaseUrl !== 'string' || /[\r\n\0]/.test(databaseUrl)) {
      throw new Error();
    }
    database = new URL(databaseUrl.trim());
    if (
      !['postgres:', 'postgresql:'].includes(database.protocol) ||
      !database.hostname ||
      !database.username ||
      !database.password ||
      database.pathname.length <= 1 ||
      database.hash
    ) {
      throw new Error();
    }
  } catch {
    throw new Error(
      'DATABASE_URL must be a complete PostgreSQL connection string with an encoded password.',
    );
  }
  if (database.port === '6543') {
    throw new Error(
      'Use Supabase Direct connection or Session pooler (5432), not Transaction pooler (6543).',
    );
  }
  if (!database.searchParams.has('sslmode')) {
    database.searchParams.set('sslmode', 'require');
  }
  if (
    !['require', 'verify-ca', 'verify-full'].includes(
      database.searchParams.get('sslmode'),
    )
  ) {
    throw new Error(
      'DATABASE_URL must require TLS (sslmode=require, verify-ca or verify-full).',
    );
  }
  if (
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(
      apiHost,
    )
  ) {
    throw new Error(
      'API domain must be a hostname, e.g. api.example.com (no https:// or path).',
    );
  }
  if (!/^[a-z0-9_-]{1,64}$/i.test(username)) {
    throw new Error(
      'Username must contain 1-64 letters, digits, underscores or hyphens.',
    );
  }
  const [algo, cost, salt, key, extra] = passwordHash.split('$');
  if (
    algo !== 'scrypt' ||
    cost !== '16384' ||
    !salt ||
    !key ||
    extra !== undefined ||
    Buffer.from(salt, 'base64').length !== 16 ||
    Buffer.from(key, 'base64').length !== 32
  ) {
    throw new Error(
      'Paste the complete hash from pnpm --filter arb-ops-web hash-password.',
    );
  }
  // Verify the parameters match the same scrypt implementation used at login.
  scryptSync('check', Buffer.from(salt, 'base64'), 32, { N: Number(cost) });
  const redisPassword = secret();
  const apiToken = secret();
  const backend = [
    'NODE_ENV=production',
    'PORT=3000',
    'HTTP_BIND_HOST=127.0.0.1',
    'WS_BIND_HOST=127.0.0.1',
    'API_DOCS_ENABLED=false',
    // Single quotes prevent Compose from expanding literal $ inside the URI.
    `DATABASE_URL='${database.toString().replaceAll("'", '%27')}'`,
    `REDIS_PASSWORD=${redisPassword}`,
    `REDIS_URL=redis://:${redisPassword}@127.0.0.1:6379`,
    'TASK_WS_PORT=3001',
    `TASK_WS_TOKEN=${secret()}`,
    'TASK_WS_MAX_PAYLOAD_MB=64',
    'CONSUMER_WS_PORT=3002',
    `CONSUMER_WS_TOKEN=${secret()}`,
    'ADMIN_WS_PORT=3003',
    `API_TOKENS=${apiToken}:${username}:admin`,
    'TASK_RUNNER_NODE_ID=node-1',
    'TASK_RUNNER_APP_URL=ws://127.0.0.1:3001',
    'RESET_ROOMS_ON_START=true',
    'MATCH_MAX_DURATION_HOURS=8',
    'DISCORD_ALERT_WEBHOOK_URL=',
    // OneSignal: báo kèo On click về điện thoại (điền tay; trống = tắt)
    'ONESIGNAL_APP_ID=',
    'ONESIGNAL_REST_API_KEY=',
    'WEB_APP_URL=',
    '',
  ].join('\n');
  // Vercel dashboard values are raw strings, not Next.js .env interpolations.
  const users = JSON.stringify([
    { username, name: username, role: 'admin', passwordHash, apiToken },
  ]);
  const vercel = [
    '# Paste each VALUE into Vercel Project Settings > Environment Variables.',
    '# Not a local Next.js .env file: preserve literal $ in WEB_USERS.',
    `BACKEND_URL=https://${apiHost}`,
    `BACKEND_ADMIN_WS_URL=wss://${apiHost}/admin-ws`,
    `SESSION_SECRET=${secret()}`,
    `WEB_USERS=${users}`,
    'ARB_MOCK=false',
    'ENABLE_EXPERIMENTAL_COREPACK=1',
    'NEXT_PUBLIC_ENV_LABEL=Production',
    '',
  ].join('\n');
  return { backend, vercel };
}

export async function writeEnvFiles(directory, env) {
  const files = [
    path.join(directory, '.env'),
    path.join(directory, 'deploy', '.env.vercel'),
  ];
  for (const file of files) {
    try {
      await access(file);
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(
      `Refusing to overwrite ${file}. Edit existing files instead.`,
    );
  }
  await writeFile(files[0], env.backend, { flag: 'wx', mode: 0o600 });
  try {
    await writeFile(files[1], env.vercel, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    await unlink(files[0]);
    throw error;
  }
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error(
      'Set DATABASE_URL to your Supabase connection string before running this script; see deploy/README.md.',
    );
  }
  const input = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    console.log(
      'First deployment only. Existing .env files will NOT be overwritten.',
    );
    const apiHost = (
      await input.question('API domain (e.g. api.example.com): ')
    ).trim();
    const username = (await input.question('Admin username: ')).trim();
    const passwordHash = (
      await input.question('Password hash (scrypt$...): ')
    ).trim();
    await writeEnvFiles(
      root,
      buildEnv({ apiHost, username, passwordHash, databaseUrl }),
    );
    console.log(
      'Created .env (VPS) and deploy/.env.vercel (Vercel values) with matching tokens.',
    );
    console.log(
      'Keep these files private; do not commit them. Back up both files securely.',
    );
  } finally {
    input.close();
  }
}

if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
