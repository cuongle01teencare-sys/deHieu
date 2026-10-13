import assert from 'node:assert/strict';
import { randomBytes, scryptSync } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseEnv } from 'node:util';
import test from 'node:test';
import { buildEnv, writeEnvFiles } from './configure-env.mjs';

const salt = randomBytes(16);
const password = 'test-only-password';
const key = scryptSync(password, salt, 32, { N: 16384 });
const passwordHash = `scrypt$16384$${salt.toString('base64')}$${key.toString('base64')}`;
const input = { apiHost: 'api.example.com', username: 'cuong', passwordHash };

test('Vercel values preserve the password hash; API and database credentials match', () => {
  const env = buildEnv(input);
  const backend = parseEnv(env.backend);
  const web = parseEnv(env.vercel);
  const user = JSON.parse(web.WEB_USERS)[0];
  assert.equal(user.passwordHash, passwordHash);
  assert.equal(backend.API_TOKENS, `${user.apiToken}:cuong:admin`);
  assert.equal(
    new URL(backend.DATABASE_URL).password,
    backend.POSTGRES_PASSWORD,
  );
  assert.equal(new URL(backend.REDIS_URL).password, backend.REDIS_PASSWORD);
  assert.equal(web.BACKEND_ADMIN_WS_URL, 'wss://api.example.com/admin-ws');
  assert.equal(web.BACKEND_URL, 'https://api.example.com');
  assert.equal(web.ARB_MOCK, 'false');
  assert.equal(backend.HTTP_BIND_HOST, '127.0.0.1');
  assert.equal(backend.WS_BIND_HOST, '127.0.0.1');
  const secrets = [
    backend.POSTGRES_PASSWORD,
    backend.REDIS_PASSWORD,
    backend.TASK_WS_TOKEN,
    backend.CONSUMER_WS_TOKEN,
    user.apiToken,
    web.SESSION_SECRET,
  ];
  assert.equal(new Set(secrets).size, secrets.length);
  assert.ok(secrets.every((value) => value.length === 64));
});

test('rejects invalid domain, username and incomplete password hash', () => {
  assert.throws(() =>
    buildEnv({ ...input, apiHost: 'https://api.example.com/' }),
  );
  assert.throws(() => buildEnv({ ...input, username: 'alice:admin\nBAD=1' }));
  assert.throws(() => buildEnv({ ...input, passwordHash: 'scrypt$...' }));
});

test('creates private files without overwriting existing secrets', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arb-deploy-test-'));
  try {
    await mkdir(path.join(directory, 'deploy'));
    const env = buildEnv(input);
    await writeEnvFiles(directory, env);
    assert.equal(
      await readFile(path.join(directory, '.env'), 'utf8'),
      env.backend,
    );
    assert.equal(
      await readFile(path.join(directory, 'deploy', '.env.vercel'), 'utf8'),
      env.vercel,
    );
    if (process.platform !== 'win32') {
      assert.equal(
        (await stat(path.join(directory, '.env'))).mode & 0o777,
        0o600,
      );
    }
    await assert.rejects(
      writeEnvFiles(directory, buildEnv(input)),
      /overwrite/,
    );
    assert.equal(
      await readFile(path.join(directory, '.env'), 'utf8'),
      env.backend,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('existing Vercel values prevent any backend file being created', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'arb-deploy-test-'));
  try {
    await mkdir(path.join(directory, 'deploy'));
    const { writeFile } = await import('node:fs/promises');
    await writeFile(path.join(directory, 'deploy', '.env.vercel'), 'existing');
    await assert.rejects(
      writeEnvFiles(directory, buildEnv(input)),
      /overwrite/,
    );
    await assert.rejects(readFile(path.join(directory, '.env')), {
      code: 'ENOENT',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
