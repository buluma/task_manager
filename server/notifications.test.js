import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

let NOW = new Date(2026, 9, 17, 12, 0, 0);
const fixture = () => ({
  data: {
    me: 'm1',
    members: [
      { id: 'm1', name: 'Me', role: 'Owner' },
      { id: 'agent-claude', name: 'Claude', role: 'Agent', agent: true },
    ],
    projects: [{ id: 'p1', key: 'GR', seq: 0, name: 'Tasks', status: 'active' }],
    tasks: [],
    activity: [],
    comments: [],
    notifs: [],
  },
  prefs: { weekStart: 1 },
});

let dir, server, base, dataFile;
beforeEach(async () => {
  NOW = new Date(2026, 9, 17, 12, 0, 0);
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

const call = async (method, url, body, agent) => {
  const headers = { ...(body ? { 'content-type': 'application/json' } : {}), ...(agent ? { 'x-gr8r-agent': agent } : {}) };
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const notifs = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).state.data.notifs;
const task = async () => (await call('POST', '/api/tasks', { title: 'alpha' })).body.task;

test('the owner writing to their own tasks raises nothing', async () => {
  await task();
  await call('POST', '/api/tasks/GR-1/comments', { text: 'note to self' });
  await call('PATCH', '/api/tasks/GR-1', { status: 'review' });
  assert.deepEqual(notifs(), []);
});

test('an agent comment notifies the owner with the comment as the snippet', async () => {
  const t = await task();
  await call('POST', '/api/tasks/GR-1/comments', { text: 'tests pass' }, 'Claude');
  const [n] = notifs();
  assert.deepEqual(
    { type: n.type, by: n.by, task: n.task, text: n.text, snippet: n.snippet, read: n.read, at: n.at },
    { type: 'comment', by: 'agent-claude', task: t.id, text: 'commented on', snippet: 'tests pass', read: false, at: NOW.getTime() },
  );
  assert.match(n.id, /^n/);
});

test('a long agent comment is cut for the snippet, and a backdated one raises nothing', async () => {
  await task();
  await call('POST', '/api/tasks/GR-1/comments', { text: 'x'.repeat(300) }, 'Claude');
  assert.equal(notifs()[0].snippet.length, 140);
  assert.ok(notifs()[0].snippet.endsWith('…'));
  await call('POST', '/api/tasks/GR-1/comments', { text: 'old news', at: '2026-07-12' }, 'Claude');
  assert.equal(notifs().length, 1);
});

test('an agent moving a task notifies as an update, and completing it says so', async () => {
  await task();
  await call('PATCH', '/api/tasks/GR-1', { status: 'review' }, 'Claude');
  await call('PATCH', '/api/tasks/GR-1', { status: 'done' }, 'Claude');
  assert.deepEqual(
    notifs().map(n => [n.type, n.text, n.snippet]),
    [
      ['update', 'moved to Review', 'Backlog → Review'],
      ['update', 'completed', 'Review → Done'],
    ],
  );
});

test('POST /api/notifications lets an agent flag a task or send a general message', async () => {
  const t = await task();
  const flag = await call('POST', '/api/notifications', { task: 'gr-1', text: 'needs your call on the schema', snippet: 'two options' }, 'Claude');
  assert.equal(flag.status, 201);
  assert.deepEqual(
    { type: flag.body.notification.type, by: flag.body.notification.by, task: flag.body.notification.task, text: flag.body.notification.text },
    { type: 'comment', by: 'agent-claude', task: t.id, text: 'needs your call on the schema' },
  );
  const general = await call('POST', '/api/notifications', { text: 'nightly run finished', type: 'update' }, 'Claude');
  assert.equal(general.body.notification.task, undefined);
  assert.equal(notifs().length, 2);
});

test('POST /api/notifications rejects bad input without changing anything', async () => {
  await task();
  const rev = JSON.parse(fs.readFileSync(dataFile, 'utf8')).rev;
  const bad = [{}, { text: '  ' }, { text: 1 }, { text: 'x'.repeat(501) }, { text: 'x', type: 'wat' }, { text: 'x', snippet: 1 }, { text: 'x', nope: 1 }];
  for (const b of bad) assert.equal((await call('POST', '/api/notifications', b)).status, 400, JSON.stringify(b));
  assert.equal((await call('POST', '/api/notifications', { text: 'x', task: 'GR-9' })).status, 404);
  assert.equal(JSON.parse(fs.readFileSync(dataFile, 'utf8')).rev, rev);
});

test('GET lists newest first, ?unread=1 filters, and PATCH marks one read or unread', async () => {
  await task();
  await call('POST', '/api/notifications', { text: 'first' }, 'Claude');
  NOW = new Date(2026, 9, 17, 13, 0, 0);
  await call('POST', '/api/notifications', { text: 'second' }, 'Claude');
  const all = (await call('GET', '/api/notifications')).body.notifications;
  assert.deepEqual(
    all.map(n => [n.text, n.from, n.key]),
    [
      ['second', 'Claude', null],
      ['first', 'Claude', null],
    ],
  );
  const patched = await call('PATCH', `/api/notifications/${all[0].id}`, { read: true });
  assert.equal(patched.body.notification.read, true);
  assert.deepEqual(
    (await call('GET', '/api/notifications?unread=1')).body.notifications.map(n => n.text),
    ['first'],
  );
  assert.equal((await call('PATCH', `/api/notifications/${all[0].id}`, { read: false })).body.notification.read, false);
  assert.equal((await call('PATCH', `/api/notifications/${all[0].id}`, { read: 'yes' })).status, 400);
  assert.equal((await call('PATCH', '/api/notifications/nope', { read: true })).status, 404);
});
