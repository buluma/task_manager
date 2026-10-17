import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const BIN = fileURLToPath(new URL('../bin/gr8r.js', import.meta.url));
const NOW = new Date(2026, 9, 17, 12, 0, 0);
const fixture = () => ({
  data: {
    me: 'm1',
    members: [{ id: 'm1', name: 'Me' }],
    projects: [{ id: 'p1', key: 'GR', seq: 0, name: 'Tasks', status: 'active' }],
    tasks: [],
    activity: [],
    comments: [],
  },
  prefs: { weekStart: 1 },
});

let dir, dataFile, server, base;
const start = async token => {
  server = createApp({ dataFile, distDir: dir, now: () => NOW, token });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
};
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr8r-'));
  dataFile = path.join(dir, 'state.json');
  fs.writeFileSync(dataFile, JSON.stringify({ rev: 1, state: fixture() }));
});
afterEach(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, { body, auth } = {}) => {
  const headers = { ...(body ? { 'content-type': 'application/json' } : {}), ...(auth ? { authorization: auth } : {}) };
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, headers: r.headers, body: await r.json() };
};
const GOOD = 'Bearer s3cret';

test('with a token set, the task, project and priority APIs refuse missing or wrong credentials', async () => {
  await start('s3cret');
  for (const [method, url, body] of [
    ['GET', '/api/tasks'],
    ['POST', '/api/tasks', { title: 'x' }],
    ['GET', '/api/tasks/GR-1'],
    ['GET', '/api/projects'],
    ['POST', '/api/projects', { name: 'x' }],
    ['GET', '/api/priorities'],
    ['POST', '/api/priorities', { name: 'x', w: 1 }],
    ['DELETE', '/api/priorities/low'],
  ]) {
    for (const auth of [undefined, 'Bearer nope', 's3cret', 'Basic s3cret', 'Bearer s3cre', 'Bearer s3cret!']) {
      const r = await call(method, url, { body, auth });
      assert.equal(r.status, 401, `${method} ${url} with ${auth}`);
      assert.match(r.headers.get('www-authenticate'), /^Bearer/);
    }
  }
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).rev, 1, 'nothing was written');
});

test('the right token works for reads and writes, and unknown routes are still 404 only after auth', async () => {
  await start('s3cret');
  assert.equal((await call('POST', '/api/tasks', { body: { title: 'x' }, auth: GOOD })).status, 201);
  assert.equal((await call('GET', '/api/tasks', { auth: GOOD })).body.tasks.length, 1);
  assert.equal((await call('GET', '/api/projects', { auth: GOOD })).status, 200);
  assert.equal((await call('GET', '/api/priorities', { auth: GOOD })).status, 200);
  assert.equal((await call('GET', '/api/nope', { auth: GOOD })).status, 404);
  assert.equal((await call('GET', '/api/nope')).status, 401);
});

test('/api/rev and /api/state stay open so the app keeps syncing', async () => {
  await start('s3cret');
  assert.equal((await call('GET', '/api/rev')).status, 200);
  assert.equal((await call('GET', '/api/state')).status, 200);
  const put = await call('PUT', '/api/state', { body: { baseRev: 1, state: { data: { tasks: [] } } } });
  assert.equal(put.status, 200);
});

test('without a token the API stays open, as before', async () => {
  await start(undefined);
  assert.equal((await call('GET', '/api/tasks')).status, 200);
  await new Promise(r => server.close(r));
  await start('');
  assert.equal((await call('GET', '/api/tasks')).status, 200, 'an empty token means none');
});

const run = (args, env) =>
  new Promise(resolve =>
    execFile(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, GR8R_URL: base, ...env } }, (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }),
    ),
  );

test('the CLI sends GR8R_TOKEN and explains a missing or wrong one', async () => {
  await start('s3cret');
  const ok = await run(['add', 'with token'], { GR8R_TOKEN: 's3cret' });
  assert.equal(ok.code, 0, ok.stderr);
  const none = await run(['list'], {});
  assert.notEqual(none.code, 0);
  assert.match(none.stderr, /GR8R_TOKEN/);
  const wrong = await run(['list'], { GR8R_TOKEN: 'nope' });
  assert.notEqual(wrong.code, 0);
  assert.match(wrong.stderr, /GR8R_TOKEN/);
  assert.doesNotMatch(wrong.stderr + none.stderr, /s3cret/);
  const list = await run(['list'], { GR8R_TOKEN: 's3cret' });
  assert.match(list.stdout, /with token/);
});
