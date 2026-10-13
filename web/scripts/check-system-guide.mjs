import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sealData } from 'iron-session';

const base = process.argv[2] ?? 'http://localhost:3101';
const secret = process.env.GUIDE_CHECK_SECRET;
if (!secret)
  throw new Error(
    'Set GUIDE_CHECK_SECRET to the isolated preview SESSION_SECRET',
  );

const publicPage = await fetch(`${base}/tai-lieu`, { redirect: 'manual' });
assert.equal(publicPage.status, 307);
assert.equal(
  new URL(publicPage.headers.get('location'), base).pathname,
  '/login',
);
assert.equal((await fetch(`${base}/api/system-guide`)).status, 401);

// A test session for the demo account on an isolated mock server.
const cookie = await sealData(
  { username: 'demo' },
  { password: secret, ttl: 3600 },
);
const headers = { Cookie: `arbops_session=${cookie}` };
const page = await fetch(`${base}/tai-lieu`, { headers });
assert.equal(page.status, 200);
const html = await page.text();
for (let index = 1; index <= 11; index++) {
  assert.ok(html.includes(`id="muc-${index}"`), `Missing section ${index}`);
  assert.ok(
    html.includes(`href="#muc-${index}"`),
    `Missing table of contents link ${index}`,
  );
}
assert.ok(html.includes('tAlliance'));
assert.ok(html.includes('Đổi cuối'));
assert.ok(html.includes('aria-label="Tìm trong tài liệu"'));
assert.ok(html.includes('href="/tai-lieu"'));

const download = await fetch(`${base}/api/system-guide`, { headers });
assert.equal(download.status, 200);
assert.ok(download.headers.get('content-type').includes('text/markdown'));
assert.ok(download.headers.get('content-disposition').includes('attachment'));
const source = await readFile(
  new URL('../content/system-guide.md', import.meta.url),
  'utf8',
);
assert.equal(await download.text(), source);
console.log(
  'PASS: authentication guards, rendered guide, 11 sections, navigation, and exact Markdown download',
);
