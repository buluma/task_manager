import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

// Saturday 2026-10-17, so the current cycle (Monday start) is 2026-10-12.
const NOW = new Date(2026, 9, 17, 12, 0, 0);
const CUR = '2026-10-12';
const fixture = () => ({
  data: {
    me: 'm1',
    members: [{ id: 'm1', name: 'Me' }],
    projects: [
      { id: 'p1', key: 'GR', seq: 0, name: 'Tasks', status: 'active' },
      { id: 'p2', key: 'WEB', seq: 200, name: 'Website', status: 'active' },
    ],
    tasks: [],
    activity: [],
    comments: [],
  },
  prefs: { weekStart: 1 },
  views: {},
});

let dir, server, base, dataFile;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr8r-'));
  dataFile = path.join(dir, 'state.json');
  fs.writeFileSync(dataFile, JSON.stringify({ rev: 1, state: fixture() }));
  server = createApp({ dataFile, distDir: dir, now: () => NOW });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const call = async (method, url, body) => {
  const r = await fetch(base + url, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const post = (b, url = '/api/tasks') => call('POST', url, b);
const stored = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));

test('POST creates a backlog task with defaults, the next key, and persists with a bumped rev', async () => {
  const r = await post({ title: '  buy milk ' });
  assert.equal(r.status, 201);
  const t = r.body.task;
  assert.equal(t.key, 'GR-1');
  assert.equal(t.title, 'buy milk');
  assert.deepEqual([t.status, t.priority, t.assignee, t.project, t.cycle], ['backlog', 'none', 'm1', 'p1', null]);
  assert.deepEqual([t.labels, t.subtasks, t.deps, t.attachments], [[], [], [], []]);
  assert.ok(t.id && t.created && t.updated && t.order === 1);
  const s = stored();
  assert.equal(s.rev, 2);
  assert.equal(s.state.data.projects[0].seq, 1);
  assert.equal(s.state.data.activity[0].verb, 'created');
  assert.equal((await post({ title: 'second' })).body.task.key, 'GR-2');
  assert.equal((await post({ title: 'third' })).body.task.order, 3);
});

test('POST resolves project by key or id, case-insensitively, and continues that project counter', async () => {
  assert.equal((await post({ title: 'a', project: 'web' })).body.task.key, 'WEB-201');
  assert.equal((await post({ title: 'b', project: 'p2' })).body.task.key, 'WEB-202');
  assert.equal((await post({ title: 'c', project: 'nope' })).status, 400);
});

test('POST accepts cycle "current" or a date and normalises it to the cycle start', async () => {
  assert.equal((await post({ title: 'a', cycle: 'current' })).body.task.cycle, CUR);
  assert.equal((await post({ title: 'b', cycle: '2026-10-14' })).body.task.cycle, CUR);
  assert.equal((await post({ title: 'b2', cycle: '2026-10-21' })).body.task.cycle, '2026-10-19');
  assert.equal((await post({ title: 'c', cycle: null })).body.task.cycle, null);
});

test('POST rejects bad input without changing anything', async () => {
  const bad = [
    {},
    { title: '   ' },
    { title: 1 },
    { title: 'x', status: 'wat' },
    { title: 'x', priority: 'huge' },
    { title: 'x', due: '10/17' },
    { title: 'x', labels: 'a' },
    { title: 'x', assignee: 'ghost' },
    { title: 'x', cycle: 'soon' },
    { title: 'x', nope: 1 },
  ];
  for (const b of bad) assert.equal((await post(b)).status, 400, JSON.stringify(b));
  assert.equal(stored().rev, 1);
});

test('POST before the app has ever saved is a 409 with a hint', async () => {
  fs.rmSync(dataFile);
  const fresh = createApp({ dataFile: path.join(dir, 'none.json'), distDir: dir, now: () => NOW });
  await new Promise(r => fresh.listen(0, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:${fresh.address().port}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{"title":"x"}',
  });
  await new Promise(r => fresh.close(r));
  assert.equal(r.status, 409);
});

test('GET lists tasks with filters and hides archived ones', async () => {
  await post({ title: 'alpha', status: 'todo', cycle: 'current' });
  await post({ title: 'beta', priority: 'high', project: 'web' });
  await post({ title: 'gamma', status: 'done', cycle: 'current' });
  const titles = async q => (await call('GET', '/api/tasks' + q)).body.tasks.map(t => t.title);
  assert.deepEqual(await titles(''), ['alpha', 'beta', 'gamma']);
  assert.deepEqual(await titles('?status=todo'), ['alpha']);
  assert.deepEqual(await titles('?project=WEB'), ['beta']);
  assert.deepEqual(await titles('?cycle=current'), ['alpha', 'gamma']);
  assert.deepEqual(await titles('?cycle=none'), ['beta']);
  assert.deepEqual(await titles('?q=ALP'), ['alpha']);
  assert.deepEqual(await titles('?priority=high'), ['beta']);
  await call('DELETE', '/api/tasks/GR-1');
  assert.deepEqual(await titles(''), ['beta', 'gamma']);
  assert.deepEqual(await titles('?archived=1'), ['alpha', 'beta', 'gamma']);
  assert.equal((await call('GET', '/api/tasks?status=wat')).status, 400);
});

test('GET one task by key, case-insensitively, 404 when missing', async () => {
  await post({ title: 'alpha' });
  assert.equal((await call('GET', '/api/tasks/gr-1')).body.task.title, 'alpha');
  assert.equal((await call('GET', '/api/tasks/GR-99')).status, 404);
});

test('PATCH updates fields, validates them, and logs activity', async () => {
  await post({ title: 'alpha' });
  const r = await call('PATCH', '/api/tasks/GR-1', { priority: 'high', due: '2026-10-20', labels: ['bug'], title: 'Alpha!', status: 'progress' });
  assert.equal(r.status, 200);
  assert.deepEqual(
    [r.body.task.priority, r.body.task.due, r.body.task.labels, r.body.task.title, r.body.task.status],
    ['high', '2026-10-20', ['bug'], 'Alpha!', 'progress'],
  );
  assert.ok(stored().state.data.activity.some(a => a.verb === 'moved'));
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { due: null })).body.task.due, null);
  const rev = stored().rev;
  for (const b of [{ status: 'wat' }, { project: 'p2' }, { key: 'X-1' }, { id: 'z' }, { title: '' }, {}])
    assert.equal((await call('PATCH', '/api/tasks/GR-1', b)).status, 400, JSON.stringify(b));
  assert.equal(stored().rev, rev);
  assert.equal((await call('PATCH', '/api/tasks/GR-9', { title: 'x' })).status, 404);
});

test('PATCH done stamps completion and records the previous status', async () => {
  await post({ title: 'alpha', status: 'progress' });
  const done = (await call('PATCH', '/api/tasks/GR-1', { status: 'done' })).body.task;
  assert.ok(done.completedAt);
  assert.equal(done.prevStatus, 'progress');
  assert.ok(stored().state.data.activity.some(a => a.verb === 'completed'));
});

test('PATCH cycle adds, moves and removes a task', async () => {
  await post({ title: 'alpha' });
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { cycle: 'current' })).body.task.cycle, CUR);
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { cycle: null })).body.task.cycle, null);
});

test('DELETE archives rather than removes, so the app can restore it', async () => {
  await post({ title: 'alpha' });
  const r = await call('DELETE', '/api/tasks/GR-1');
  assert.equal(r.status, 200);
  assert.equal(r.body.task.archived, true);
  assert.equal(stored().state.data.tasks.length, 1);
  assert.equal((await call('GET', '/api/tasks/GR-1')).body.task.archived, true);
});

test('GET /api/projects and /api/rev', async () => {
  const p = await call('GET', '/api/projects');
  assert.deepEqual(
    p.body.projects.map(x => [x.id, x.key, x.name]),
    [
      ['p1', 'GR', 'Tasks'],
      ['p2', 'WEB', 'Website'],
    ],
  );
  assert.deepEqual((await call('GET', '/api/rev')).body, { rev: 1 });
  await post({ title: 'x' });
  assert.deepEqual((await call('GET', '/api/rev')).body, { rev: 2 });
});

test('a task change makes a stale whole-state write fail with 409', async () => {
  await post({ title: 'alpha' });
  const r = await fetch(`${base}/api/state`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ baseRev: 1, state: fixture() }),
  });
  assert.equal(r.status, 409);
});

test('cross-origin task writes are refused and unknown routes are 404/405', async () => {
  const r = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: '{"title":"x"}',
  });
  assert.equal(r.status, 403);
  assert.equal((await call('GET', '/api/nope')).status, 404);
  assert.equal((await call('PUT', '/api/tasks', { title: 'x' })).status, 405);
});
