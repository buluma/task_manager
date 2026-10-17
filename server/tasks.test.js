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
  for (const b of [{ status: 'wat' }, { project: 'nope' }, { key: 'X-1' }, { id: 'z' }, { title: '' }, {}])
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

test('inherited object keys are not valid statuses or priorities', async () => {
  for (const bad of ['constructor', 'toString', '__proto__', 'hasOwnProperty']) {
    assert.equal((await post({ title: 'x', status: bad })).status, 400, bad);
    assert.equal((await post({ title: 'x', priority: bad })).status, 400, bad);
    assert.equal((await call('GET', `/api/tasks?status=${bad}`)).status, 400, bad);
    assert.equal((await call('GET', `/api/tasks?priority=${bad}`)).status, 400, bad);
  }
  assert.equal(stored().rev, 1);
});

test('PATCH project moves a task: new key from the target counter, logged, old key gone', async () => {
  await post({ title: 'wander' });
  const r = await call('PATCH', '/api/tasks/GR-1', { project: 'web' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.task.key, r.body.task.project], ['WEB-201', 'p2']);
  const s = stored().state.data;
  assert.equal(s.projects[1].seq, 201);
  assert.deepEqual([s.activity[0].verb, s.activity[0].extra], ['moved', 'to Website']);
  assert.equal((await call('GET', '/api/tasks/GR-1')).status, 404);
  assert.equal((await call('GET', '/api/tasks/web-201')).body.task.title, 'wander');
  assert.equal((await call('GET', '/api/tasks?project=GR')).body.tasks.length, 0);
});

test('PATCH project to the same project changes nothing; unknown or archived targets are 400', async () => {
  await post({ title: 'stay' });
  const same = await call('PATCH', '/api/tasks/GR-1', { project: 'GR' });
  assert.equal(same.body.task.key, 'GR-1');
  assert.equal(stored().state.data.projects[0].seq, 1);
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { project: 'NOPE' })).status, 400);
  await call('DELETE', '/api/projects/WEB');
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { project: 'WEB' })).status, 400);
});

test('desc is plain text: escaped, blank lines split paragraphs, single newlines break lines', async () => {
  const one = await post({ title: 'a', desc: '  fish & <chips>  ' });
  assert.equal(one.body.task.desc, '<p>fish &amp; &lt;chips&gt;</p>');
  const many = await post({ title: 'b', desc: 'first line\nsecond line\n\n\nnext paragraph' });
  assert.equal(many.body.task.desc, '<p>first line<br>second line</p><p>next paragraph</p>');
  const crlf = await call('PATCH', '/api/tasks/GR-2', { desc: 'a\r\n\r\nb' });
  assert.equal(crlf.body.task.desc, '<p>a</p><p>b</p>');
  assert.equal((await call('PATCH', '/api/tasks/GR-2', { desc: '   ' })).body.task.desc, '');
});

test('DELETE ?purge=1 permanently removes an archived task, its comments and dependency links', async () => {
  await post({ title: 'keep' });
  await post({ title: 'doomed' });
  const s = stored();
  s.state.data.tasks[0].deps = [s.state.data.tasks[1].id];
  s.state.data.comments = [
    { id: 'c1', task: s.state.data.tasks[1].id, text: 'bye' },
    { id: 'c2', task: s.state.data.tasks[0].id, text: 'stay' },
  ];
  fs.writeFileSync(dataFile, JSON.stringify(s));
  await server.close();
  server = createApp({ dataFile, distDir: dir, now: () => NOW });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const early = await call('DELETE', '/api/tasks/GR-2?purge=1');
  assert.equal(early.status, 409, 'must be archived first');
  assert.match(early.body.error, /archive/i);
  assert.equal((await call('DELETE', '/api/tasks/GR-2')).status, 200);
  const r = await call('DELETE', '/api/tasks/GR-2?purge=1');
  assert.equal(r.status, 200);
  assert.equal(r.body.task.key, 'GR-2');
  const d = stored().state.data;
  assert.deepEqual(
    d.tasks.map(t => t.key),
    ['GR-1'],
  );
  assert.deepEqual(d.tasks[0].deps, []);
  assert.deepEqual(
    d.comments.map(c => c.id),
    ['c2'],
  );
  assert.equal((await call('GET', '/api/tasks/GR-2')).status, 404);
  assert.equal((await call('DELETE', '/api/tasks/GR-2?purge=1')).status, 404);
});

test('completed sets or clears the completion date of a done task, and only of a done task', async () => {
  const t = (await post({ title: 'old news', status: 'done', completed: '2026-07-12' })).body.task;
  assert.equal(t.completedAt, new Date(2026, 6, 12, 12, 0, 0).getTime());
  assert.equal(t.completed, undefined, 'the input field is not stored');
  const moved = await call('PATCH', '/api/tasks/GR-1', { completed: '2026-07-13' });
  assert.equal(moved.body.task.completedAt, new Date(2026, 6, 13, 12, 0, 0).getTime());
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { completed: null })).body.task.completedAt, null);

  await post({ title: 'open' });
  const notDone = await call('PATCH', '/api/tasks/GR-2', { completed: '2026-07-12' });
  assert.equal(notDone.status, 400);
  assert.match(notDone.body.error, /done/);
  assert.equal((await post({ title: 'x', completed: '2026-07-12' })).status, 400);
  assert.equal((await call('PATCH', '/api/tasks/GR-2', { completed: '2026-02-30' })).status, 400);
  assert.equal((await call('PATCH', '/api/tasks/GR-2', { completed: 'yesterday' })).status, 400);

  const both = await call('PATCH', '/api/tasks/GR-2', { status: 'done', completed: '2026-06-01' });
  assert.equal(both.body.task.completedAt, new Date(2026, 5, 1, 12, 0, 0).getTime(), 'the given date wins over now');
  const plain = await call('PATCH', '/api/tasks/GR-1', { status: 'progress' });
  assert.equal(plain.status, 200);
  const back = await call('PATCH', '/api/tasks/GR-1', { status: 'done' });
  assert.ok(back.body.task.completedAt >= NOW.getTime(), 'completing without a date still stamps now');
});

test('recur is validated; completing a repeating task with a due date schedules the next one, like the app', async () => {
  await post({ title: 'standup', due: '2026-10-19', recur: 'Weekly', labels: ['ops'], priority: 'high' });
  assert.equal((await post({ title: 'x', recur: 'Hourly' })).status, 400);
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { recur: 'Fortnightly' })).status, 400);
  const s = stored();
  s.state.data.tasks[0].subtasks = [{ id: 's1', title: 'agenda', done: true }];
  fs.writeFileSync(dataFile, JSON.stringify(s));
  await server.close();
  server = createApp({ dataFile, distDir: dir, now: () => NOW });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const r = await call('PATCH', '/api/tasks/GR-1', { status: 'done' });
  assert.equal(r.status, 200);
  assert.equal(r.body.task.status, 'done');
  const n = r.body.next;
  assert.deepEqual(
    [n.key, n.title, n.status, n.due, n.start, n.recur, n.priority, n.labels],
    ['GR-2', 'standup', 'todo', '2026-10-26', '2026-10-26', 'Weekly', 'high', ['ops']],
  );
  assert.deepEqual(n.subtasks, [{ id: 's1', title: 'agenda', done: false }]);
  assert.equal(n.completedAt, undefined);
  assert.notEqual(n.id, r.body.task.id);
  const d = stored().state.data;
  assert.equal(d.tasks.length, 2);
  assert.equal(d.projects[0].seq, 2);
  assert.equal(d.activity[0].verb, 'created');

  assert.equal((await call('PATCH', '/api/tasks/GR-1', { status: 'done' })).body.next, undefined, 'no second spawn for an unchanged status');
});

test('completing a task without a repeat, or without a due date, schedules nothing', async () => {
  await post({ title: 'plain', due: '2026-10-19' });
  await post({ title: 'no due', recur: 'Daily' });
  assert.equal((await call('PATCH', '/api/tasks/GR-1', { status: 'done' })).body.next, undefined);
  assert.equal((await call('PATCH', '/api/tasks/GR-2', { status: 'done' })).body.next, undefined);
  assert.equal(stored().state.data.tasks.length, 2);
});

test("each repeat length moves the due date by the app's number of days", async () => {
  const days = { Daily: '2026-10-20', Weekly: '2026-10-26', 'Every 2 weeks': '2026-11-02', Monthly: '2026-11-18' };
  let n = 0;
  for (const [recur, expected] of Object.entries(days)) {
    await post({ title: recur, due: '2026-10-19', recur });
    const r = await call('PATCH', `/api/tasks/GR-${++n}`, { status: 'done' });
    assert.equal(r.body.next.due, expected, recur);
    n++;
  }
});

test('descFormat "markdown" renders the description as safe HTML; the default stays plain text', async () => {
  const md = await post({ title: 'md', desc: '## Plan\n\n* **one**\n* `two`\n\n<script>x</script>', descFormat: 'markdown' });
  assert.equal(md.status, 201);
  assert.equal(md.body.task.desc, '<h4>Plan</h4><ul><li><b>one</b></li><li><code>two</code></li></ul><p>&lt;script&gt;x&lt;/script&gt;</p>');
  assert.equal(md.body.task.descFormat, undefined, 'the format is an input, not stored');
  const plain = await post({ title: 'plain', desc: '## Plan\n* not a list' });
  assert.equal(plain.body.task.desc, '<p>## Plan<br>* not a list</p>');
  const patched = await call('PATCH', '/api/tasks/GR-2', { desc: '**now bold**', descFormat: 'markdown' });
  assert.equal(patched.body.task.desc, '<p><b>now bold</b></p>');
  assert.equal((await call('PATCH', '/api/tasks/GR-2', { desc: '   ', descFormat: 'markdown' })).body.task.desc, '');
  assert.equal((await post({ title: 'x', desc: 'a', descFormat: 'html' })).status, 400);
  assert.equal((await post({ title: 'x', descFormat: 'markdown' })).status, 400, 'a format without a description');
});
