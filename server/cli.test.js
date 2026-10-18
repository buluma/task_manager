import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const BIN = fileURLToPath(new URL('../bin/gr8r.js', import.meta.url));
const NOW = new Date(2026, 9, 17, 12, 0, 0);

let dir, server, url;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr8r-'));
  const state = {
    data: {
      me: 'm1',
      members: [{ id: 'm1', name: 'Me' }],
      projects: [{ id: 'p1', key: 'GR', seq: 0, name: 'Tasks', status: 'active' }],
      tasks: [],
      activity: [],
      comments: [],
    },
    prefs: { weekStart: 1 },
  };
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ rev: 1, state }));
  server = createApp({ dataFile: path.join(dir, 'state.json'), distDir: dir, now: () => NOW });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${server.address().port}`;
});
afterEach(async () => {
  await new Promise(r => server.close(r));
  fs.rmSync(dir, { recursive: true, force: true });
});

const run = (args, env = { GR8R_URL: url }) =>
  new Promise(resolve =>
    execFile(process.execPath, [BIN, ...args], { env: { PATH: process.env.PATH, GR8R_ENV_FILE: '', ...env } }, (err, stdout, stderr) =>
      resolve({ code: err?.code ?? 0, stdout, stderr }),
    ),
  );

test('add prints the new key; list, show and --json reflect it', async () => {
  const add = await run(['add', 'buy milk', '--priority', 'high', '--cycle', 'current', '--label', 'home', '--label', 'errand']);
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /GR-1/);
  const list = await run(['list']);
  assert.match(list.stdout, /GR-1\s+backlog\s+high\s+buy milk/);
  const json = JSON.parse((await run(['list', '--json'])).stdout);
  assert.deepEqual([json[0].key, json[0].cycle, json[0].labels], ['GR-1', '2026-10-12', ['home', 'errand']]);
  const show = await run(['show', 'gr-1']);
  assert.match(show.stdout, /buy milk/);
  assert.match(show.stdout, /home, errand/);
});

test('set, done and rm change the task; none clears a field', async () => {
  await run(['add', 'alpha', '--due', '2026-10-20']);
  assert.equal((await run(['set', 'GR-1', '--status', 'progress', '--due', 'none', '--title', 'Alpha'])).code, 0);
  let t = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout);
  assert.deepEqual([t.status, t.due, t.title], ['progress', null, 'Alpha']);
  assert.equal((await run(['set', 'GR-1', '--priority', 'high'])).code, 0);
  assert.equal((await run(['set', 'GR-1', '--priority', 'none', '--label', 'none'])).code, 0);
  t = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout);
  assert.deepEqual([t.priority, t.labels], ['none', []]);
  assert.equal((await run(['done', 'GR-1'])).code, 0);
  t = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout);
  assert.equal(t.status, 'done');
  assert.equal((await run(['rm', 'GR-1'])).code, 0);
  assert.doesNotMatch((await run(['list'])).stdout, /GR-1/);
  assert.match((await run(['list', '--archived'])).stdout, /GR-1/);
});

test('list filters and projects command', async () => {
  await run(['add', 'one', '--status', 'todo']);
  await run(['add', 'two']);
  const out = (await run(['list', '--status', 'todo'])).stdout;
  assert.match(out, /one/);
  assert.doesNotMatch(out, /two/);
  assert.match((await run(['projects'])).stdout, /GR\s+Tasks/);
});

test('errors exit non-zero with a one-line message on stderr', async () => {
  const missing = await run(['show', 'GR-9']);
  assert.notEqual(missing.code, 0);
  assert.match(missing.stderr, /^error: no task GR-9/);
  const invalid = await run(['add', 'x', '--status', 'wat']);
  assert.notEqual(invalid.code, 0);
  assert.match(invalid.stderr, /status must be one of/);
  assert.notEqual((await run(['add'])).code, 0);
  assert.notEqual((await run(['frobnicate'])).code, 0);
  assert.notEqual((await run(['list', '--bogus'])).code, 0);
});

test('an unreachable server explains how to point the CLI at it', async () => {
  const r = await run(['list'], { GR8R_URL: 'http://127.0.0.1:1' });
  assert.notEqual(r.code, 0);
  assert.match(r.stderr, /GR8R_URL/);
  assert.match(r.stderr, /bad port/);
});

test('a server that never answers times out instead of hanging', async () => {
  const silent = http.createServer(() => {});
  await new Promise(r => silent.listen(0, '127.0.0.1', r));
  try {
    const r = await run(['list'], { GR8R_URL: `http://127.0.0.1:${silent.address().port}`, GR8R_TIMEOUT_MS: '200' });
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /did not answer within/);
  } finally {
    silent.closeAllConnections();
    await new Promise(r => silent.close(r));
  }
});

test('project add, set and rm manage projects; --archived lists the removed ones', async () => {
  const add = await run(['project', 'add', 'Website Launch', '--key', 'web', '--color', 'teal', '--desc', 'ship it']);
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /created WEB\s+Website Launch/);
  assert.match((await run(['projects'])).stdout, /WEB\s+Website Launch/);
  assert.equal((await run(['project', 'set', 'WEB', '--name', 'Site', '--status', 'active', '--due', '2026-12-01'])).code, 0);
  let p = JSON.parse((await run(['project', 'show', 'web', '--json'])).stdout);
  assert.deepEqual([p.name, p.status, p.due, p.color], ['Site', 'active', '2026-12-01', 'teal']);
  assert.equal((await run(['project', 'set', 'WEB', '--due', 'none'])).code, 0);
  p = JSON.parse((await run(['project', 'show', 'web', '--json'])).stdout);
  assert.equal(p.due, null);
  assert.equal((await run(['project', 'rm', 'WEB'])).code, 0);
  assert.doesNotMatch((await run(['projects'])).stdout, /WEB/);
  assert.match((await run(['projects', '--archived'])).stdout, /WEB\s+Site\s+\[archived\]/);
  assert.equal((await run(['project', 'restore', 'WEB'])).code, 0);
  assert.match((await run(['projects'])).stdout, /WEB/);
  const bad = await run(['project', 'set', 'WEB', '--key', 'ZZ']);
  assert.notEqual(bad.code, 0);
  assert.match(bad.stderr, /key cannot be changed/);
  assert.notEqual((await run(['project', 'add'])).code, 0);
  assert.notEqual((await run(['project', 'frob', 'WEB'])).code, 0);
});

test('priority add, set and rm edit the scale, and tasks can use new levels', async () => {
  assert.match((await run(['priorities'])).stdout, /urgent\s+4\s+Urgent/);
  const add = await run(['priority', 'add', 'Blocker', '--weight', '5']);
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /created blocker\s+5\s+Blocker/);
  assert.match((await run(['priorities'])).stdout.split('\n')[0], /^blocker\s+5\s+Blocker/);
  assert.equal((await run(['add', 'x', '--priority', 'blocker'])).code, 0);
  assert.equal((await run(['priority', 'set', 'blocker', '--name', 'Showstopper', '--weight', '6'])).code, 0);
  assert.match((await run(['priorities'])).stdout, /blocker\s+6\s+Showstopper\s+1 task/);
  const rm = await run(['priority', 'rm', 'blocker', '--replace', 'high']);
  assert.equal(rm.code, 0, rm.stderr);
  assert.match(rm.stdout, /deleted blocker, moved 1 task to high/);
  assert.equal(JSON.parse((await run(['show', 'GR-1', '--json'])).stdout).priority, 'high');
  assert.notEqual((await run(['priority', 'add', 'No weight'])).code, 0);
  assert.notEqual((await run(['priority', 'rm', 'none'])).code, 0);
});

test('set --project moves a task to another project under a new key', async () => {
  await run(['project', 'add', 'Website', '--key', 'WEB']);
  await run(['add', 'wander']);
  const r = await run(['set', 'GR-1', '--project', 'web']);
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /updated WEB-1/);
  assert.match((await run(['show', 'GR-1'])).stderr, /no task GR-1/);
});

test('show prints each description paragraph and line on its own line', async () => {
  await run(['add', 'notes', '--desc', 'line one\nline two\n\nsecond paragraph']);
  const out = (await run(['show', 'GR-1'])).stdout;
  assert.match(out, /line one\nline two\n+second paragraph/);
});

test('rm --purge removes an archived task for good; project rm --purge does the same for a project', async () => {
  await run(['add', 'doomed']);
  const early = await run(['rm', 'GR-1', '--purge']);
  assert.notEqual(early.code, 0);
  assert.match(early.stderr, /archive/i);
  assert.equal((await run(['rm', 'GR-1'])).code, 0);
  const gone = await run(['rm', 'GR-1', '--purge']);
  assert.equal(gone.code, 0, gone.stderr);
  assert.match(gone.stdout, /deleted GR-1/);
  assert.match((await run(['show', 'GR-1'])).stderr, /no task GR-1/);

  await run(['project', 'add', 'Doomed', '--key', 'DM']);
  await run(['add', 'inside', '--project', 'DM']);
  assert.equal((await run(['project', 'rm', 'DM'])).code, 0);
  const p = await run(['project', 'rm', 'DM', '--purge']);
  assert.equal(p.code, 0, p.stderr);
  assert.match(p.stdout, /deleted DM.*1 task/);
  assert.doesNotMatch((await run(['projects', '--archived'])).stdout, /DM/);
});

test("--completed sets a done task's completion date and none clears it", async () => {
  await run(['add', 'old news', '--status', 'done', '--completed', '2026-07-12']);
  let t = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout);
  assert.equal(t.completedAt, new Date(2026, 6, 12, 12, 0, 0).getTime());
  assert.equal((await run(['set', 'GR-1', '--completed', 'none'])).code, 0);
  t = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout);
  assert.equal(t.completedAt, null);
});

test('pr link records a GitHub PR as a comment, once, and rejects anything else', async () => {
  await run(['add', 'ship it']);
  const pr = 'https://github.com/buluma/task_manager/pull/12';
  const first = await run(['pr', 'link', 'gr-1', pr]);
  assert.equal(first.code, 0, first.stderr);
  assert.match(first.stdout, /linked GR-1/);
  const again = await run(['pr', 'link', 'GR-1', pr]);
  assert.equal(again.code, 0, again.stderr);
  assert.match(again.stdout, /already linked/);
  const comments = JSON.parse((await run(['comments', 'GR-1', '--json'])).stdout);
  assert.deepEqual(
    comments.map(c => c.text),
    [`PR: ${pr}`],
  );
  assert.notEqual((await run(['pr', 'link', 'GR-1', 'https://example.com/pull/1'])).code, 0);
  assert.notEqual((await run(['pr', 'link', 'GR-1'])).code, 0);
  assert.notEqual((await run(['pr', 'nope', 'GR-1', pr])).code, 0);
  assert.match((await run(['pr', 'link', 'GR-9', pr])).stderr, /no task GR-9/);
});

test('agent add registers an agent, agent list shows it, and --as attributes a write to it', async () => {
  const add = await run(['agent', 'add', 'Claude']);
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /added agent Claude\s+agent-claude/);
  assert.match((await run(['agent', 'list'])).stdout, /agent-claude\s+Claude/);
  assert.notEqual((await run(['agent', 'add', 'Claude'])).code, 0);
  await run(['add', 'ship it']);
  assert.equal((await run(['comment', 'GR-1', 'done by a bot', '--as', 'claude'])).code, 0);
  assert.equal((await run(['comment', 'GR-1', 'done by me'])).code, 0);
  const by = JSON.parse((await run(['comments', 'GR-1', '--json'])).stdout).map(c => c.by);
  assert.deepEqual(by, ['agent-claude', 'm1']);
  const ghost = await run(['comment', 'GR-1', 'x', '--as', 'ghost']);
  assert.notEqual(ghost.code, 0);
  assert.match(ghost.stderr, /unknown agent/);
  assert.notEqual((await run(['agent', 'nope'])).code, 0);
});

test('notify raises an Inbox item as an agent; inbox lists it and read/unread mark it', async () => {
  await run(['agent', 'add', 'Claude']);
  await run(['add', 'ship it']);
  const n = await run(['notify', 'needs your call', '--task', 'gr-1', '--snippet', 'two options', '--as', 'Claude']);
  assert.equal(n.code, 0, n.stderr);
  assert.match(n.stdout, /notified/);
  await run(['comment', 'GR-1', 'tests pass', '--as', 'Claude']);
  const list = await run(['inbox']);
  assert.match(list.stdout, /Claude\s+commented on\s+GR-1\s+tests pass/);
  assert.match(list.stdout, /Claude\s+needs your call\s+GR-1\s+two options/);
  const items = JSON.parse((await run(['inbox', '--json'])).stdout);
  assert.equal(items.length, 2);
  assert.equal((await run(['inbox', 'read', items[0].id])).code, 0);
  assert.equal(JSON.parse((await run(['inbox', '--unread', '--json'])).stdout).length, 1);
  assert.equal((await run(['inbox', 'unread', items[0].id])).code, 0);
  assert.equal(JSON.parse((await run(['inbox', '--unread', '--json'])).stdout).length, 2);
  assert.notEqual((await run(['notify'])).code, 0);
  assert.notEqual((await run(['notify', 'x', '--type', 'wat'])).code, 0);
  assert.notEqual((await run(['inbox', 'read'])).code, 0);
  assert.notEqual((await run(['inbox', 'read', 'nope'])).code, 0);
});

test('comment adds, comments lists, comment rm deletes', async () => {
  await run(['add', 'host']);
  const add = await run(['comment', 'GR-1', 'looks', 'good', '--at', '2026-07-12']);
  assert.equal(add.code, 0, add.stderr);
  assert.match(add.stdout, /commented on GR-1/);
  await run(['comment', 'GR-1', 'ship it']);
  const list = await run(['comments', 'GR-1']);
  assert.match(list.stdout, /2026-07-12 00:00 +\w+\nlooks good/);
  assert.match(list.stdout, /ship it/);
  const id = JSON.parse((await run(['comments', 'GR-1', '--json'])).stdout)[0].id;
  assert.equal((await run(['comment', 'rm', 'GR-1', id])).code, 0);
  assert.doesNotMatch((await run(['comments', 'GR-1'])).stdout, /looks good/);
  assert.notEqual((await run(['comment', 'GR-1'])).code, 0);
  assert.match((await run(['comments', 'GR-9'])).stderr, /no task GR-9/);
});

test('--recur sets the repeat and completing a due task prints the next one', async () => {
  await run(['add', 'standup', '--due', '2026-10-19', '--recur', 'Weekly']);
  const done = await run(['done', 'GR-1']);
  assert.equal(done.code, 0, done.stderr);
  assert.match(done.stdout, /next GR-2.*2026-10-26/);
  assert.equal((await run(['set', 'GR-2', '--recur', 'none'])).code, 0);
  assert.equal(JSON.parse((await run(['show', 'GR-2', '--json'])).stdout).recur, null);
});

test('--markdown renders the description, and show prints headings and lists on their own lines', async () => {
  await run(['add', 'notes', '--markdown', '--desc', '## Plan\n\n* first\n* second **bold**\n\nclosing line']);
  const raw = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout).desc;
  assert.match(raw, /<h4>Plan<\/h4><ul><li>first<\/li>/);
  const out = (await run(['show', 'GR-1'])).stdout;
  assert.match(out, /Plan\n+• first\n• second bold\n+closing line/);
});

test('subtask add, done, reopen, rm and dep add, deps, dep rm work from the shell', async () => {
  await run(['add', 'parent']);
  await run(['add', 'blocker']);
  const add = await run(['subtask', 'add', 'GR-1', 'write', 'tests']);
  assert.equal(add.code, 0, add.stderr);
  const id = JSON.parse((await run(['show', 'GR-1', '--json'])).stdout).subtasks[0].id;
  assert.match((await run(['show', 'GR-1'])).stdout, /\[ \] write tests/);
  assert.equal((await run(['subtask', 'done', 'GR-1', id])).code, 0);
  assert.match((await run(['show', 'GR-1'])).stdout, /\[x\] write tests/);
  assert.equal((await run(['subtask', 'reopen', 'GR-1', id])).code, 0);
  assert.equal((await run(['subtask', 'rm', 'GR-1', id])).code, 0);
  assert.doesNotMatch((await run(['show', 'GR-1'])).stdout, /write tests/);

  assert.equal((await run(['dep', 'add', 'GR-1', 'GR-2'])).code, 0);
  assert.match((await run(['deps', 'GR-1'])).stdout, /GR-2\s+backlog\s+blocker/);
  const self = await run(['dep', 'add', 'GR-1', 'GR-1']);
  assert.notEqual(self.code, 0);
  assert.equal((await run(['dep', 'rm', 'GR-1', 'GR-2'])).code, 0);
  assert.match((await run(['deps', 'GR-1'])).stdout, /no dependencies/);
  assert.notEqual((await run(['subtask', 'add', 'GR-1'])).code, 0);
  assert.notEqual((await run(['subtask', 'frob', 'GR-1'])).code, 0);
});
