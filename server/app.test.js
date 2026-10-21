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

test('closeMergedReviews moves Review tasks whose PR merged to Done, once, and tells the Inbox', async () => {
  const states = { 'o/r#1': 'merged', 'o/r#2': 'open', 'o/r#3': 'merged' };
  const asked = [];
  const prStates = async refs => (asked.push(refs), Object.fromEntries(refs.map(r => [r, states[r] ?? null])));
  const app = createApp({ dataFile, distDir: path.join(dir, 'dist'), prStates, now: () => new Date(2026, 9, 22, 9) });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${app.address().port}`;
  const read = async () => (await (await fetch(`${at}/api/state`)).json()).state.data;
  try {
    assert.deepEqual(await app.closeMergedReviews(), []);
    const task = (id, key, status) => ({ id, key, title: key, status, project: 'p1', labels: [], subtasks: [], order: 1, created: 1, updated: 1 });
    const data = {
      me: 'u1',
      members: [{ id: 'u1', name: 'Me' }],
      projects: [{ id: 'p1', key: 'A', name: 'A' }],
      tasks: [task('t1', 'A-1', 'review'), task('t2', 'A-2', 'review'), task('t3', 'A-3', 'progress')],
      comments: [
        { id: 'c1', task: 't1', at: 1, text: 'PR: https://github.com/o/r/pull/1' },
        { id: 'c2', task: 't2', at: 1, text: 'PR: https://github.com/o/r/pull/2' },
        { id: 'c3', task: 't3', at: 1, text: 'PR: https://github.com/o/r/pull/3' },
      ],
      activity: [],
      notifs: [],
    };
    await fetch(`${at}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, state: { data, prefs: {} } }),
    });
    assert.deepEqual(await app.closeMergedReviews(), ['A-1']);
    let d = await read();
    assert.deepEqual(
      d.tasks.map(t => t.status),
      ['done', 'review', 'progress'],
    );
    assert.equal(d.notifs.length, 1);
    assert.equal(d.notifs[0].task, 't1');
    assert.match(d.notifs[0].snippet, /o\/r#1 merged/);
    assert.deepEqual(asked, [['o/r#1', 'o/r#2']]);
    const rev = (await (await fetch(`${at}/api/rev`)).json()).rev;

    // nothing new merged: no write
    assert.deepEqual(await app.closeMergedReviews(), []);
    assert.equal((await (await fetch(`${at}/api/rev`)).json()).rev, rev);

    // put back in Review by hand, it stays there
    d = await read();
    d.tasks[0].status = 'review';
    await fetch(`${at}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: rev, state: { data: d, prefs: {} } }),
    });
    assert.deepEqual(await app.closeMergedReviews(), []);
    assert.equal((await read()).tasks[0].status, 'review');
  } finally {
    await new Promise(r => app.close(r));
  }
});

test('syncProjectPrs links PRs that name a task in the project repo, moves a task to Review when its PR opens, and reports a close', async () => {
  let list = [];
  const asked = [];
  const pulls = async repo => (asked.push(repo), repo === 'o/r' ? list : null);
  const app = createApp({ dataFile, distDir: path.join(dir, 'dist'), prStates: async () => ({}), pulls, now: () => new Date(2026, 9, 22, 9) });
  await new Promise(r => app.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${app.address().port}`;
  const read = async () => (await (await fetch(`${at}/api/state`)).json()).state.data;
  const rev = async () => (await (await fetch(`${at}/api/rev`)).json()).rev;
  const pr = (n, state, title, body = '') => ({ ref: `o/r#${n}`, url: `https://github.com/o/r/pull/${n}`, title, body, branch: `b${n}`, state });
  try {
    assert.deepEqual(await app.syncProjectPrs(), []);
    const task = (id, key, status) => ({ id, key, title: key, status, project: 'p1', labels: [], subtasks: [], order: 1, created: 1, updated: 1 });
    const data = {
      me: 'u1',
      members: [{ id: 'u1', name: 'Me' }],
      projects: [
        { id: 'p1', key: 'A', name: 'A', repo: 'o/r' },
        { id: 'p2', key: 'B', name: 'B', repo: 'o/gone' },
        { id: 'p3', key: 'C', name: 'C' },
      ],
      tasks: [task('t1', 'A-1', 'progress'), task('t2', 'A-2', 'todo'), task('t3', 'A-3', 'done'), task('t4', 'A-4', 'progress')],
      comments: [],
      activity: [],
      notifs: [],
    };
    await fetch(`${at}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 0, state: { data, prefs: {} } }),
    });

    // first look at a repo: link what names a task, move nothing
    list = [pr(1, 'open', 'fix (A-1)'), pr(2, 'merged', 'old work', 'Implements A-3.')];
    assert.deepEqual((await app.syncProjectPrs()).sort(), ['linked A-1 to o/r#1', 'linked A-3 to o/r#2']);
    assert.deepEqual(asked.sort(), ['o/gone', 'o/r']);
    let d = await read();
    assert.deepEqual(
      d.comments.map(c => [c.task, c.text]),
      [
        ['t1', 'PR: https://github.com/o/r/pull/1'],
        ['t3', 'PR: https://github.com/o/r/pull/2'],
      ],
    );
    assert.deepEqual(
      d.tasks.map(t => t.status),
      ['progress', 'todo', 'done', 'progress'],
    );
    assert.equal(d.notifs.length, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(path.dirname(dataFile), 'pr-seen.json'), 'utf8')), {
      repos: { 'o/r': { 'o/r#1': 'open', 'o/r#2': 'merged' } },
    });

    // later: #1 closed unmerged, #3 opened for A-2, #4 opened and merged between two looks for A-4
    list = [pr(1, 'closed', 'fix (A-1)'), pr(3, 'open', 'x', 'Fixes A-2'), pr(4, 'merged', 'A-4 quick fix'), pr(2, 'merged', 'old work', 'Implements A-3.')];
    assert.deepEqual((await app.syncProjectPrs()).sort(), [
      'A-1: o/r#1 closed without merging',
      'A-2: o/r#3 opened, moved to Review',
      'A-4: o/r#4 opened, moved to Review',
      'linked A-2 to o/r#3',
      'linked A-4 to o/r#4',
    ]);
    d = await read();
    assert.deepEqual(
      d.tasks.map(t => t.status),
      ['progress', 'review', 'done', 'review'],
    );
    assert.deepEqual(d.notifs.map(n => [n.task, n.text, n.snippet]).sort(), [
      ['t1', 'PR closed without merging', 'o/r#1'],
      ['t2', 'moved to Review', 'o/r#3 opened'],
      ['t4', 'moved to Review', 'o/r#4 opened'],
    ]);

    // nothing new: no write
    const before = await rev();
    assert.deepEqual(await app.syncProjectPrs(), []);
    assert.equal(await rev(), before);
  } finally {
    await new Promise(r => app.close(r));
  }
});
