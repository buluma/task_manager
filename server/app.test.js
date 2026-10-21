import { test, beforeEach, afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

let dir, server, base, dataFile;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr8r-'));
  fs.mkdirSync(path.join(dir, 'dist'));
  fs.writeFileSync(path.join(dir, 'dist', 'index.html'), '<h1>app</h1>');
  fs.writeFileSync(path.join(dir, 'dist', 'a.js'), 'x');
  dataFile = path.join(dir, 'data', 'state.json');
  server = createApp({ dataFile, distDir: path.join(dir, 'dist') });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const put = (body, headers = {}) =>
  fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
const state = { data: { tasks: [{ id: 't1' }] }, prefs: {} };

test('GET before any save is 404', async () => {
  const r = await fetch(`${base}/api/state`);
  assert.equal(r.status, 404);
});

test('PUT then GET round-trips state and bumps rev', async () => {
  const r1 = await put({ baseRev: 0, state });
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { rev: 1 });
  const r2 = await (await fetch(`${base}/api/state`)).json();
  assert.deepEqual(r2, { rev: 1, state });
  const r3 = await put({ baseRev: 1, state });
  assert.deepEqual(await r3.json(), { rev: 2 });
});

test('PUT with a stale baseRev is 409 and leaves data untouched', async () => {
  await put({ baseRev: 0, state });
  const r = await put({ baseRev: 0, state: { data: { tasks: [] } } });
  assert.equal(r.status, 409);
  assert.deepEqual(await r.json(), { rev: 1 });
  assert.deepEqual((await (await fetch(`${base}/api/state`)).json()).state, state);
});

test('state survives a restart and the previous revision is kept as a backup', async () => {
  await put({ baseRev: 0, state });
  await put({ baseRev: 1, state: { data: { tasks: [] } } });
  assert.ok(fs.existsSync(`${dataFile}.bak`));
  const again = createApp({ dataFile, distDir: path.join(dir, 'dist') });
  await new Promise(r => again.listen(0, '127.0.0.1', r));
  const body = await (await fetch(`http://127.0.0.1:${again.address().port}/api/state`)).json();
  await new Promise(r => again.close(r));
  assert.equal(body.rev, 2);
});

test('a save is flushed to disk before it replaces the previous file', async () => {
  const log = [];
  const { fsyncSync, renameSync } = fs;
  mock.method(fs, 'fsyncSync', fd => (log.push('fsync'), fsyncSync(fd)));
  mock.method(fs, 'renameSync', (a, b) => (log.push('rename'), renameSync(a, b)));
  try {
    assert.equal((await put({ baseRev: 0, state })).status, 200);
  } finally {
    mock.restoreAll();
  }
  // The temp file is synced before the rename, and the directory after it so the rename itself survives a crash.
  assert.deepEqual(log, ['fsync', 'rename', 'fsync']);
});

test('rejects malformed JSON, wrong shape, wrong content type, and oversize bodies', async () => {
  assert.equal((await put('{nope')).status, 400);
  assert.equal((await put({ baseRev: 0, state: { nope: 1 } })).status, 400);
  assert.equal((await put({ baseRev: 'x', state })).status, 400);
  assert.equal((await put({ baseRev: 0, state }, { 'content-type': 'text/plain' })).status, 415);
  assert.equal((await put({ baseRev: 0, state: { data: { tasks: [], pad: 'x'.repeat(11 * 1024 * 1024) } } })).status, 413);
  assert.equal((await fetch(`${base}/api/state`)).status, 404);
});

test('rejects cross-origin writes', async () => {
  const r = await put({ baseRev: 0, state }, { origin: 'https://evil.example' });
  assert.equal(r.status, 403);
  const same = await put({ baseRev: 0, state }, { origin: base });
  assert.equal(same.status, 200);
});

test('unsupported methods on /api/state are 405', async () => {
  const r = await fetch(`${base}/api/state`, { method: 'DELETE' });
  assert.equal(r.status, 405);
});

test('serves dist files and falls back to index.html, without escaping dist', async () => {
  assert.equal(await (await fetch(`${base}/a.js`)).text(), 'x');
  assert.equal((await fetch(`${base}/a.js`)).headers.get('content-type'), 'text/javascript; charset=utf-8');
  assert.equal(await (await fetch(`${base}/`)).text(), '<h1>app</h1>');
  assert.equal(await (await fetch(`${base}/some/route`)).text(), '<h1>app</h1>');
  const sock = await fetch(`${base}/..%2fdata%2fstate.json`);
  assert.equal(await sock.text(), '<h1>app</h1>');
});

test('app pages carry a CSP that only runs scripts from this origin', async () => {
  for (const p of ['/', '/some/route', '/a.js']) {
    const h = (await fetch(`${base}${p}`)).headers;
    const csp = h.get('content-security-policy') || '';
    assert.match(csp, /script-src 'self'(;|$)/, p);
    assert.match(csp, /object-src 'none'/, p);
    assert.match(csp, /frame-ancestors 'none'/, p);
    assert.equal(h.get('x-content-type-options'), 'nosniff', p);
  }
});

test('hashed assets are cached for good, index.html is revalidated', async () => {
  fs.mkdirSync(path.join(dir, 'dist', 'assets'));
  fs.writeFileSync(path.join(dir, 'dist', 'assets', 'main-AbC123.js'), 'y');
  assert.equal((await fetch(`${base}/assets/main-AbC123.js`)).headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.equal((await fetch(`${base}/`)).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${base}/some/route`)).headers.get('cache-control'), 'no-cache');
  assert.equal((await fetch(`${base}/a.js`)).headers.get('cache-control'), 'no-cache');
  // A missing asset falls back to index.html, which must not be cached as if it were the asset.
  assert.equal((await fetch(`${base}/assets/gone-XyZ.js`)).headers.get('cache-control'), 'no-cache');
});

test('GET /api/prs answers, without the token, only for PRs linked in a comment', async () => {
  const asked = [];
  const prStates = async refs => (asked.push(...refs), Object.fromEntries(refs.map(r => [r, 'merged'])));
  const app = createApp({ dataFile, distDir: path.join(dir, 'dist'), token: 'secret', prStates });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${app.address().port}`;
  try {
    assert.equal((await fetch(`${at}/api/prs?ref=a/b%231`)).status, 409);
    const linked = { data: { tasks: [{ id: 't1' }], comments: [{ task: 't1', text: 'PR: https://github.com/a/b/pull/1' }] }, prefs: {} };
    await fetch(`${at}/api/state`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: 0, state: linked }) });
    const r = await fetch(`${at}/api/prs?ref=a/b%231&ref=x/private%239`);
    assert.equal(r.status, 200);
    assert.deepEqual(await r.json(), { prs: { 'a/b#1': 'merged', 'x/private#9': null } });
    assert.deepEqual(asked, ['a/b#1']);
    const many = new URLSearchParams(Array.from({ length: 201 }, (_, i) => ['ref', `a/b#${i}`]));
    assert.equal((await fetch(`${at}/api/prs?${many}`)).status, 400);
    assert.equal((await fetch(`${at}/api/prs`, { method: 'POST' })).status, 405);
  } finally {
    await new Promise(r => app.close(r));
  }
});
