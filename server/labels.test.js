import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

const fixture = () => ({
  data: {
    me: 'm1',
    members: [{ id: 'm1', name: 'Me' }],
    projects: [{ id: 'p1', key: 'GR', seq: 2, name: 'Tasks' }],
    tasks: [
      { id: 't1', key: 'GR-1', project: 'p1', title: 'a', status: 'todo', labels: ['Bug', 'Improvement'], deps: [], subtasks: [] },
      { id: 't2', key: 'GR-2', project: 'p1', title: 'b', status: 'todo', labels: [], deps: [], subtasks: [] },
    ],
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
  server = createApp({ dataFile, distDir: dir, now: () => new Date(2026, 9, 19) });
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
const data = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).state.data;

test('GET /api/labels lists the built-in labels and the ones in use, with task counts, without saving', async () => {
  const { labels } = (await call('GET', '/api/labels')).body;
  assert.deepEqual(
    labels.find(l => l.id === 'bug'),
    { id: 'bug', name: 'Bug', color: 'red', tasks: 1 },
  );
  assert.deepEqual(labels.at(-1), { id: 'Improvement', name: 'Improvement', color: 'gray', tasks: 1 });
  assert.equal(data().labels, undefined);
});

test('POST, PATCH and DELETE /api/labels add, change and remove a label', async () => {
  const r = await call('POST', '/api/labels', { name: 'Chore', color: 'teal' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.label, { id: 'Chore', name: 'Chore', color: 'teal' });
  assert.equal((await call('POST', '/api/labels', { name: 'chore' })).status, 400);
  const p = await call('PATCH', '/api/labels/improvement', { name: 'Enhancement', color: 'green' });
  assert.deepEqual(p.body.label, { id: 'Improvement', name: 'Enhancement', color: 'green' });
  assert.equal((await call('PATCH', '/api/labels/nope', { name: 'x' })).status, 404);
  const d = await call('DELETE', '/api/labels/BUG');
  assert.deepEqual([d.status, d.body.removed], [200, 1]);
  assert.deepEqual(data().tasks[0].labels, ['Improvement']);
  assert.ok(!data().labels.some(l => l.id === 'bug'));
});
