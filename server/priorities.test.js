import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

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
const stored = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
const ids = r => r.body.priorities.map(p => p.id);

test('GET returns the default scale, highest weight first, without writing anything', async () => {
  const r = await call('GET', '/api/priorities');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.priorities.map(p => [p.id, p.name, p.w, p.tasks]),
    [
      ['urgent', 'Urgent', 4, 0],
      ['high', 'High', 3, 0],
      ['medium', 'Medium', 2, 0],
      ['low', 'Low', 1, 0],
      ['none', 'No priority', 0, 0],
    ],
  );
  assert.equal(stored().rev, 1);
  assert.equal(stored().state.data.priorities, undefined);
});

test('POST adds a level, derives the id from the name, and tasks can use it', async () => {
  const r = await call('POST', '/api/priorities', { name: 'Blocker', w: 5 });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.priority, { id: 'blocker', name: 'Blocker', w: 5 });
  assert.deepEqual(ids(await call('GET', '/api/priorities')), ['blocker', 'urgent', 'high', 'medium', 'low', 'none']);
  const s = stored();
  assert.equal(s.rev, 2);
  assert.equal(s.state.data.priorities.length, 6);
  const t = await call('POST', '/api/tasks', { title: 'x', priority: 'blocker' });
  assert.equal(t.status, 201);
  assert.equal(t.body.task.priority, 'blocker');
  assert.equal((await call('GET', '/api/tasks?priority=blocker')).body.tasks.length, 1);
});

test('POST accepts an explicit id and rejects bad or duplicate input', async () => {
  assert.equal((await call('POST', '/api/priorities', { id: 'p0', name: 'Fire', w: 9 })).body.priority.id, 'p0');
  for (const body of [
    {},
    { name: '', w: 1 },
    { name: 'No weight' },
    { name: 'Zero', w: 0 },
    { name: 'Frac', w: 1.5 },
    { name: 'Huge', w: 100 },
    { name: 'Dup', id: 'high', w: 3 },
    { name: 'Bad id', id: 'Not Ok', w: 3 },
    { name: '!!!', w: 3 },
    { name: 'x', w: 1, bogus: 1 },
  ]) {
    const r = await call('POST', '/api/priorities', body);
    assert.equal(r.status, 400, JSON.stringify(body));
  }
  assert.equal(stored().rev, 2);
});

test('PATCH renames and reweights a level; none keeps weight 0', async () => {
  const r = await call('PATCH', '/api/priorities/medium', { name: 'Normal', w: 2 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.priority, { id: 'medium', name: 'Normal', w: 2 });
  await call('PATCH', '/api/priorities/low', { w: 6 });
  assert.deepEqual(ids(await call('GET', '/api/priorities')), ['low', 'urgent', 'high', 'medium', 'none']);
  assert.equal((await call('PATCH', '/api/priorities/none', { name: 'Unranked' })).status, 200);
  assert.equal((await call('PATCH', '/api/priorities/none', { w: 1 })).status, 400);
  assert.equal((await call('PATCH', '/api/priorities/high', { id: 'x' })).status, 400);
  assert.equal((await call('PATCH', '/api/priorities/high', {})).status, 400);
  assert.equal((await call('PATCH', '/api/priorities/nope', { name: 'x' })).status, 404);
});

test('DELETE removes a level and moves its tasks to none, or to ?replace', async () => {
  await call('POST', '/api/tasks', { title: 'a', priority: 'low' });
  await call('POST', '/api/tasks', { title: 'b', priority: 'low' });
  await call('POST', '/api/tasks', { title: 'c', priority: 'high' });
  const r = await call('DELETE', '/api/priorities/low');
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, 2);
  const tasks = stored().state.data.tasks;
  assert.deepEqual(
    tasks.map(t => t.priority),
    ['none', 'none', 'high'],
  );
  assert.deepEqual(ids(await call('GET', '/api/priorities')), ['urgent', 'high', 'medium', 'none']);
  const r2 = await call('DELETE', '/api/priorities/high?replace=medium');
  assert.equal(r2.body.moved, 1);
  assert.equal(stored().state.data.tasks[2].priority, 'medium');
});

test('DELETE refuses none, unknown levels, bad replacements, and a task using a deleted level stays valid', async () => {
  assert.equal((await call('DELETE', '/api/priorities/none')).status, 400);
  assert.equal((await call('DELETE', '/api/priorities/nope')).status, 404);
  assert.equal((await call('DELETE', '/api/priorities/low?replace=low')).status, 400);
  assert.equal((await call('DELETE', '/api/priorities/low?replace=nope')).status, 400);
  assert.equal(stored().rev, 1);
  await call('DELETE', '/api/priorities/low');
  assert.equal((await call('POST', '/api/tasks', { title: 'x', priority: 'low' })).status, 400);
});

test('an archived task is moved too, and the activity log names the new level', async () => {
  await call('POST', '/api/priorities', { name: 'Blocker', w: 5 });
  await call('POST', '/api/tasks', { title: 'x', priority: 'high' });
  await call('PATCH', '/api/tasks/GR-1', { priority: 'blocker' });
  assert.equal(stored().state.data.activity[0].extra, 'to Blocker');
  await call('DELETE', '/api/tasks/GR-1');
  const r = await call('DELETE', '/api/priorities/blocker');
  assert.equal(r.body.moved, 1);
  assert.equal(stored().state.data.tasks[0].priority, 'none');
});
