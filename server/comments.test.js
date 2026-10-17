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
const withTask = () => call('POST', '/api/tasks', { title: 'host' });

test('POST adds a comment as the current user, stamps now, and logs the activity', async () => {
  await withTask();
  const r = await call('POST', '/api/tasks/GR-1/comments', { text: '  first thoughts  ' });
  assert.equal(r.status, 201);
  const c = r.body.comment;
  assert.deepEqual([c.text, c.by, c.at, c.re], ['first thoughts', 'm1', NOW.getTime(), {}]);
  assert.ok(c.id && c.task);
  const d = stored().state.data;
  assert.equal(d.comments.length, 1);
  assert.equal(d.comments[0].task, d.tasks[0].id);
  assert.equal(d.activity[0].verb, 'commented on');
});

test("GET lists a task's comments oldest first, and only that task's", async () => {
  await withTask();
  await call('POST', '/api/tasks', { title: 'other' });
  await call('POST', '/api/tasks/GR-1/comments', { text: 'newer', at: '2026-10-02T10:00:00Z' });
  await call('POST', '/api/tasks/GR-1/comments', { text: 'older', at: '2026-08-01T10:00:00Z' });
  await call('POST', '/api/tasks/GR-2/comments', { text: 'elsewhere' });
  const r = await call('GET', '/api/tasks/gr-1/comments');
  assert.equal(r.status, 200);
  assert.deepEqual(
    r.body.comments.map(c => c.text),
    ['older', 'newer'],
  );
  assert.equal((await call('GET', '/api/tasks/GR-9/comments')).status, 404);
});

test('an explicit "at" backdates the comment and skips the activity log, so history can be imported', async () => {
  await withTask();
  const before = stored().state.data.activity.length;
  const r = await call('POST', '/api/tasks/GR-1/comments', { text: 'from 2026', at: '2026-07-12T01:26:09.666Z' });
  assert.equal(r.body.comment.at, Date.parse('2026-07-12T01:26:09.666Z'));
  assert.equal(stored().state.data.activity.length, before);
});

test('POST rejects bad input without changing anything', async () => {
  await withTask();
  const rev = stored().rev;
  for (const body of [
    {},
    { text: '' },
    { text: '   ' },
    { text: 5 },
    { text: 'x', at: 'last tuesday' },
    { text: 'x', by: 'm1' },
    { text: 'x'.repeat(20001) },
  ]) {
    const r = await call('POST', '/api/tasks/GR-1/comments', body);
    assert.equal(r.status, 400, JSON.stringify(body).slice(0, 60));
  }
  assert.equal((await call('POST', '/api/tasks/GR-9/comments', { text: 'x' })).status, 404);
  assert.equal(stored().rev, rev);
});

test('DELETE removes one comment of that task only', async () => {
  await withTask();
  await call('POST', '/api/tasks', { title: 'other' });
  const a = (await call('POST', '/api/tasks/GR-1/comments', { text: 'a' })).body.comment;
  const b = (await call('POST', '/api/tasks/GR-1/comments', { text: 'b' })).body.comment;
  const o = (await call('POST', '/api/tasks/GR-2/comments', { text: 'o' })).body.comment;
  assert.equal((await call('DELETE', `/api/tasks/GR-1/comments/${a.id}`)).status, 200);
  assert.deepEqual(
    (await call('GET', '/api/tasks/GR-1/comments')).body.comments.map(c => c.text),
    ['b'],
  );
  assert.equal((await call('DELETE', `/api/tasks/GR-1/comments/${o.id}`)).status, 404, "not this task's comment");
  assert.equal((await call('DELETE', `/api/tasks/GR-1/comments/${a.id}`)).status, 404);
  assert.equal(stored().state.data.comments.length, 2);
  assert.ok(b);
});

test('unsupported methods are 405', async () => {
  await withTask();
  assert.equal((await call('PUT', '/api/tasks/GR-1/comments', { text: 'x' })).status, 405);
  assert.equal((await call('PATCH', '/api/tasks/GR-1/comments/c1', { text: 'x' })).status, 405);
});
