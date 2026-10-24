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
    members: [{ id: 'm1', name: 'Me', role: 'Owner' }],
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

const call = async (method, url, body, agent) => {
  const headers = { ...(body ? { 'content-type': 'application/json' } : {}), ...(agent ? { 'x-gr8r-agent': agent } : {}) };
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
};
const stored = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));

test('POST /api/agents registers an agent as a member and GET lists only agents', async () => {
  const r = await call('POST', '/api/agents', { name: 'Claude' });
  assert.equal(r.status, 201);
  assert.equal(r.body.agent.name, 'Claude');
  assert.equal(r.body.agent.agent, true);
  assert.equal(r.body.agent.id, 'agent-claude');
  assert.equal(stored().state.data.members.length, 2);
  const list = await call('GET', '/api/agents');
  assert.deepEqual(
    list.body.agents.map(a => a.name),
    ['Claude'],
  );
});

test('agent names must be new, non-empty and the only field', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  const rev = stored().rev;
  for (const b of [{}, { name: '  ' }, { name: 1 }, { name: 'claude' }, { name: 'Me' }, { name: 'x', role: 'Owner' }])
    assert.equal((await call('POST', '/api/agents', b)).status, 400, JSON.stringify(b));
  assert.equal(stored().rev, rev);
});

test('a write carrying X-Gr8r-Agent is attributed to that agent, by id or by name', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  await call('POST', '/api/tasks', { title: 'alpha' });
  assert.equal((await call('POST', '/api/tasks/GR-1/comments', { text: 'by name' }, 'claude')).status, 201);
  assert.equal((await call('POST', '/api/tasks/GR-1/comments', { text: 'by id' }, 'agent-claude')).status, 201);
  assert.equal((await call('POST', '/api/tasks/GR-1/comments', { text: 'mine' })).status, 201);
  const { comments, activity } = stored().state.data;
  assert.deepEqual(
    comments.map(c => [c.text, c.by]),
    [
      ['by name', 'agent-claude'],
      ['by id', 'agent-claude'],
      ['mine', 'm1'],
    ],
  );
  assert.deepEqual(
    activity.filter(a => a.verb === 'commented on').map(a => a.by),
    ['m1', 'agent-claude', 'agent-claude'],
  );
});

test('an agent can create and change tasks; the work is logged to the agent, and it owns what it creates', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  const t = (await call('POST', '/api/tasks', { title: 'from an agent' }, 'Claude')).body.task;
  assert.equal(t.assignee, 'agent-claude');
  await call('PATCH', '/api/tasks/GR-1', { status: 'review' }, 'Claude');
  const acts = stored().state.data.activity;
  assert.deepEqual(
    acts.map(a => [a.verb, a.by]),
    [
      ['moved', 'agent-claude'],
      ['created', 'agent-claude'],
    ],
  );
});

test('an explicit assignee wins over the agent, and the owner keeps the tasks they create', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  assert.equal((await call('POST', '/api/tasks', { title: 'for me', assignee: 'm1' }, 'Claude')).body.task.assignee, 'm1');
  assert.equal((await call('POST', '/api/tasks', { title: 'mine' })).body.task.assignee, 'm1');
});

test('an agent joins a project the first time it creates or moves a task there', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  await call('POST', '/api/agents', { name: 'GitHub' });
  await call('POST', '/api/tasks', { title: 'a' });
  assert.deepEqual(stored().state.data.projects[0].members, ['m1']);
  await call('POST', '/api/tasks', { title: 'b' }, 'Claude');
  await call('POST', '/api/tasks', { title: 'c' }, 'Claude');
  assert.deepEqual(stored().state.data.projects[0].members, ['m1', 'agent-claude']);
  await call('PATCH', '/api/tasks/GR-1', { status: 'review' }, 'GitHub');
  assert.deepEqual(stored().state.data.projects[0].members, ['m1', 'agent-claude', 'agent-github']);
  assert.equal(stored().state.data.tasks[0].assignee, 'm1', 'moving a task does not take it over');
});

test('an agent that creates a project is one of its members', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  const p = (await call('POST', '/api/projects', { name: 'Agent work' }, 'Claude')).body.project;
  assert.deepEqual(p.members, ['m1', 'agent-claude']);
  assert.equal(p.lead, 'm1');
});

test('the actor is never stored in the state', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  await call('POST', '/api/tasks', { title: 'x' }, 'Claude');
  const { data } = stored().state;
  assert.equal(data.me, 'm1');
  assert.equal('actor' in data, false);
});

test('an unknown agent, or a header naming a human, is refused and nothing is written', async () => {
  await call('POST', '/api/agents', { name: 'Claude' });
  const rev = stored().rev;
  for (const who of ['ghost', 'Me', 'm1']) {
    const r = await call('POST', '/api/tasks', { title: 'x' }, who);
    assert.equal(r.status, 400, who);
    assert.match(r.body.error, /unknown agent/);
  }
  assert.equal(stored().rev, rev);
});
