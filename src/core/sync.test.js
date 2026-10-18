import { test } from 'node:test';
import assert from 'node:assert/strict';

/* A stand-in for /api/state with the server's revision rule, and a fresh copy of sync.js per test
   (it keeps its revision in module state). */
globalThis.window = new EventTarget();
let server,
  writes,
  n = 0;
globalThis.fetch = async (url, opt = {}) => {
  const reply = (status, body) => ({ status, ok: status < 300, json: async () => structuredClone(body) });
  if (url !== '/api/state') return reply(404, {});
  if (!opt.method) {
    const r = reply(200, { rev: server.rev, state: server.state });
    server.onGet?.(); // another write lands right after this read
    return r;
  }
  const { baseRev, state } = JSON.parse(opt.body);
  writes++;
  if (baseRev !== server.rev) return reply(409, { rev: server.rev });
  server = { ...server, rev: server.rev + 1, state };
  return reply(200, { rev: server.rev });
};
const fresh = () => import(`./sync.js?${n++}`);
const events = () => {
  const seen = { merged: [], conflict: 0 };
  const onMerged = e => seen.merged.push(e.detail);
  const onConflict = () => seen.conflict++;
  window.addEventListener('gr8r:merged', onMerged);
  window.addEventListener('gr8r:conflict', onConflict);
  seen.stop = () => (window.removeEventListener('gr8r:merged', onMerged), window.removeEventListener('gr8r:conflict', onConflict));
  return seen;
};
const ws = () => ({
  data: {
    projects: [{ id: 'p1', key: 'GR', seq: 2 }],
    tasks: [
      { id: 't1', key: 'GR-1', project: 'p1', status: 'todo', title: 'one' },
      { id: 't2', key: 'GR-2', project: 'p1', status: 'todo', title: 'two' },
    ],
  },
  prefs: {},
});

test('a save that loses the race is merged with the other write instead of dropped', async () => {
  server = { rev: 1, state: ws() };
  writes = 0;
  const sync = await fresh();
  const mine = await sync.pull();
  server.state.data.tasks[1].status = 'done'; // the CLI closes t2
  server.rev = 2;
  mine.data.tasks[0].title = 'one, renamed in the app';
  const seen = events();
  await sync.push(structuredClone(mine));
  seen.stop();
  assert.equal(server.rev, 3);
  assert.equal(server.state.data.tasks[0].title, 'one, renamed in the app');
  assert.equal(server.state.data.tasks[1].status, 'done');
  assert.equal(seen.conflict, 0);
  assert.equal(seen.merged.length, 1, 'the app is handed the merged state to adopt');
  assert.deepEqual(seen.merged[0].conflicts, []);
  assert.deepEqual(seen.merged[0].state, server.state);
  assert.ok(sync.syncing());
});

test('the next save after a merge builds on the merged revision', async () => {
  server = { rev: 1, state: ws() };
  writes = 0;
  const sync = await fresh();
  const mine = await sync.pull();
  server.state.data.tasks[1].status = 'done';
  server.rev = 2;
  mine.data.tasks[0].status = 'progress';
  const seen = events();
  await sync.push(structuredClone(mine));
  const adopted = seen.merged[0].state;
  adopted.data.tasks[0].status = 'review';
  await sync.push(structuredClone(adopted));
  seen.stop();
  assert.equal(server.rev, 4);
  assert.equal(writes, 3, 'one 409, the merged save, then a plain save');
  assert.equal(server.state.data.tasks[1].status, 'done', 'their change is not reverted by the later save');
  assert.equal(server.state.data.tasks[0].status, 'review');
});

test('the same field changed on both sides keeps theirs and says so', async () => {
  server = { rev: 1, state: ws() };
  writes = 0;
  const sync = await fresh();
  const mine = await sync.pull();
  server.state.data.tasks[0].status = 'done';
  server.rev = 2;
  mine.data.tasks[0].status = 'review';
  const seen = events();
  await sync.push(structuredClone(mine));
  seen.stop();
  assert.equal(server.state.data.tasks[0].status, 'done');
  assert.deepEqual(seen.merged[0].conflicts, [['data', 'tasks', 't1', 'status']]);
});

test('a server that keeps moving gets a few merge attempts, then sync stops as before', async () => {
  server = { rev: 1, state: ws() };
  writes = 0;
  const sync = await fresh();
  const mine = await sync.pull();
  server.rev = 2; // someone else saved, and keeps saving every time we look
  server.onGet = () => server.rev++;
  mine.data.tasks[0].title = 'never lands';
  const seen = events();
  await sync.push(structuredClone(mine));
  seen.stop();
  assert.equal(seen.conflict, 1);
  assert.ok(!sync.syncing());
  assert.ok(writes <= 4, `bounded: ${writes} writes`);
  assert.notEqual(server.state.data.tasks[0].title, 'never lands');
});
