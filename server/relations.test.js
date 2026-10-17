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
const tasks = async n => {
  for (let i = 0; i < n; i++) await call('POST', '/api/tasks', { title: `task ${i + 1}` });
};

test('POST adds a subtask like the app does and logs it', async () => {
  await tasks(1);
  const r = await call('POST', '/api/tasks/GR-1/subtasks', { title: '  write tests ' });
  assert.equal(r.status, 201);
  assert.deepEqual([r.body.subtask.title, r.body.subtask.done], ['write tests', false]);
  assert.ok(r.body.subtask.id);
  const d = stored().state.data;
  assert.equal(d.tasks[0].subtasks.length, 1);
  assert.equal(d.activity[0].verb, 'added subtask to');
  assert.equal(d.activity[0].extra, '“write tests”');
  assert.equal((await call('GET', '/api/tasks/GR-1')).body.task.subtasks[0].title, 'write tests');
});

test('PATCH completes, reopens and renames a subtask', async () => {
  await tasks(1);
  const id = (await call('POST', '/api/tasks/GR-1/subtasks', { title: 'a' })).body.subtask.id;
  assert.equal((await call('PATCH', `/api/tasks/GR-1/subtasks/${id}`, { done: true })).body.subtask.done, true);
  assert.equal(stored().state.data.activity[0].verb, 'completed subtask on');
  assert.equal((await call('PATCH', `/api/tasks/GR-1/subtasks/${id}`, { done: false })).body.subtask.done, false);
  assert.equal(stored().state.data.activity[0].verb, 'reopened subtask on');
  const renamed = await call('PATCH', `/api/tasks/GR-1/subtasks/${id}`, { title: 'b', done: true });
  assert.deepEqual([renamed.body.subtask.title, renamed.body.subtask.done], ['b', true]);
});

test('DELETE removes a subtask; bad input and unknown ids are rejected', async () => {
  await tasks(2);
  const id = (await call('POST', '/api/tasks/GR-1/subtasks', { title: 'a' })).body.subtask.id;
  const other = (await call('POST', '/api/tasks/GR-2/subtasks', { title: 'z' })).body.subtask.id;
  const rev = stored().rev;
  for (const body of [{}, { title: '' }, { title: 5 }, { title: 'x', done: true }, { title: 'x'.repeat(501) }])
    assert.equal((await call('POST', '/api/tasks/GR-1/subtasks', body)).status, 400, JSON.stringify(body).slice(0, 40));
  for (const body of [{}, { done: 'yes' }, { title: ' ' }, { id: 'x' }])
    assert.equal((await call('PATCH', `/api/tasks/GR-1/subtasks/${id}`, body)).status, 400);
  assert.equal((await call('PATCH', `/api/tasks/GR-1/subtasks/${other}`, { done: true })).status, 404, "not this task's subtask");
  assert.equal((await call('POST', '/api/tasks/GR-9/subtasks', { title: 'x' })).status, 404);
  assert.equal(stored().rev, rev);
  assert.equal((await call('DELETE', `/api/tasks/GR-1/subtasks/${id}`)).status, 200);
  assert.equal(stored().state.data.tasks[0].subtasks.length, 0);
  assert.equal((await call('DELETE', `/api/tasks/GR-1/subtasks/${id}`)).status, 404);
});

test("dependencies: add by key, list with keys, remove, and the app's purge keeps them clean", async () => {
  await tasks(3);
  const add = await call('POST', '/api/tasks/GR-1/deps', { on: 'gr-2' });
  assert.equal(add.status, 201);
  assert.deepEqual(
    add.body.deps.map(d => d.key),
    ['GR-2'],
  );
  await call('POST', '/api/tasks/GR-1/deps', { on: 'GR-3' });
  const list = await call('GET', '/api/tasks/GR-1/deps');
  assert.deepEqual(
    list.body.deps.map(d => [d.key, d.title, d.status]),
    [
      ['GR-2', 'task 2', 'backlog'],
      ['GR-3', 'task 3', 'backlog'],
    ],
  );
  assert.equal(stored().state.data.activity[0].verb, 'updated dependencies of');
  const stateDeps = stored().state.data.tasks[0].deps;
  assert.equal(stateDeps.length, 2, 'stored as task ids, like the app');
  assert.equal((await call('DELETE', '/api/tasks/GR-1/deps/GR-2')).body.deps.length, 1);
  assert.deepEqual(
    (await call('GET', '/api/tasks/GR-1/deps')).body.deps.map(d => d.key),
    ['GR-3'],
  );
});

test('dependencies reject self, duplicates, unknown tasks and bad bodies', async () => {
  await tasks(2);
  await call('POST', '/api/tasks/GR-1/deps', { on: 'GR-2' });
  const rev = stored().rev;
  assert.equal((await call('POST', '/api/tasks/GR-1/deps', { on: 'GR-1' })).status, 400, 'itself');
  assert.equal((await call('POST', '/api/tasks/GR-1/deps', { on: 'GR-2' })).status, 400, 'twice');
  assert.equal((await call('POST', '/api/tasks/GR-1/deps', { on: 'GR-9' })).status, 404);
  assert.equal((await call('POST', '/api/tasks/GR-1/deps', {})).status, 400);
  assert.equal((await call('POST', '/api/tasks/GR-1/deps', { on: 'GR-2', extra: 1 })).status, 400);
  assert.equal((await call('DELETE', '/api/tasks/GR-1/deps/GR-9')).status, 404);
  assert.equal((await call('DELETE', '/api/tasks/GR-2/deps/GR-1')).status, 404, 'no such link');
  assert.equal(stored().rev, rev);
});

test('unsupported methods are 405', async () => {
  await tasks(1);
  assert.equal((await call('PUT', '/api/tasks/GR-1/subtasks', {})).status, 405);
  assert.equal((await call('GET', '/api/tasks/GR-1/subtasks/s1')).status, 405);
  assert.equal((await call('PATCH', '/api/tasks/GR-1/deps', {})).status, 405);
});
