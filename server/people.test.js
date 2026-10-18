import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';

const NOW = new Date(2026, 9, 19, 12, 0, 0);
const fixture = () => ({
  data: {
    me: 'm1',
    members: [
      { id: 'm1', name: 'Me', email: 'me@x.io', role: 'Owner', team: 'eng' },
      { id: 'm2', name: 'Ada', email: 'ada@x.io', role: 'Member', team: 'eng' },
      { id: 'agent-bot', name: 'bot', email: '', role: 'Agent', team: '', agent: true },
    ],
    teams: [
      { id: 'eng', name: 'Engineering', desc: 'Builds it', icon: 'code', c: '#3B82C4' },
      { id: 'mkt', name: 'Marketing', desc: 'Tells people', icon: 'megaphone', c: '#C54B78' },
    ],
    projects: [
      { id: 'p1', key: 'GR', seq: 1, name: 'Tasks', status: 'active', team: 'eng', members: ['m1', 'm2'], milestones: [{ name: 'Beta', date: '2026-11-01' }] },
    ],
    tasks: [{ id: 't1', key: 'GR-1', project: 'p1', title: 'a', status: 'todo', assignee: 'm2', deps: [], subtasks: [], labels: [] }],
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
const data = () => JSON.parse(fs.readFileSync(dataFile, 'utf8')).state.data;

test('GET /api/members lists everyone, agents included', async () => {
  const r = await call('GET', '/api/members');
  assert.deepEqual(
    r.body.members.map(m => m.id),
    ['m1', 'm2', 'agent-bot'],
  );
});

test('POST /api/members adds new addresses like the app does and skips known ones', async () => {
  const r = await call('POST', '/api/members', { emails: ['grace.hopper@navy.mil', 'ada@x.io'], role: 'Admin', team: 'Marketing' });
  assert.equal(r.status, 201);
  assert.deepEqual(
    r.body.members.map(m => [m.name, m.role, m.team, m.title]),
    [['Grace Hopper', 'Admin', 'mkt', 'Admin']],
  );
  const one = await call('POST', '/api/members', { email: 'lin@x.io' });
  assert.deepEqual([one.body.members[0].role, one.body.members[0].team], ['Member', '']);
  assert.equal(data().members.length, 5);
});

test('POST /api/members rejects bad input without changing anything', async () => {
  for (const body of [
    {},
    { email: 'nope' },
    { emails: [] },
    { email: 'a@b.co', role: 'Owner' },
    { email: 'a@b.co', team: 'Nowhere' },
    { email: 'a@b.co', extra: 1 },
  ])
    assert.equal((await call('POST', '/api/members', body)).status, 400, JSON.stringify(body));
  assert.equal(data().members.length, 3);
});

test('PATCH /api/members changes name, title, role and team; the owner keeps their role and agents keep theirs', async () => {
  const r = await call('PATCH', '/api/members/ada@x.io', { name: 'Ada L.', title: 'Analyst', role: 'Guest', team: 'mkt' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.member.name, r.body.member.title, r.body.member.role, r.body.member.team], ['Ada L.', 'Analyst', 'Guest', 'mkt']);
  assert.equal((await call('PATCH', '/api/members/m2', { team: null })).body.member.team, '');
  assert.equal((await call('PATCH', '/api/members/m1', { role: 'Admin' })).status, 400);
  assert.equal((await call('PATCH', '/api/members/agent-bot', { role: 'Member' })).status, 400);
  assert.equal((await call('PATCH', '/api/members/m2', { role: 'Boss' })).status, 400);
  assert.equal((await call('PATCH', '/api/members/m2', { name: '  ' })).status, 400);
  assert.equal((await call('PATCH', '/api/members/m9', { name: 'x' })).status, 404);
});

test('DELETE /api/members removes a member like the app does; the owner and you cannot be removed', async () => {
  const r = await call('DELETE', '/api/members/m2');
  assert.equal(r.status, 200);
  const d = data();
  assert.deepEqual(
    d.members.map(m => m.id),
    ['m1', 'agent-bot'],
  );
  assert.equal(d.tasks[0].assignee, null);
  assert.deepEqual(d.projects[0].members, ['m1']);
  assert.equal((await call('DELETE', '/api/members/m1')).status, 409);
});

test('GET /api/teams shows the default teams for a workspace that has none, without saving them', async () => {
  const s = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  delete s.state.data.teams;
  fs.writeFileSync(dataFile, JSON.stringify(s));
  await new Promise(r => server.close(r));
  server = createApp({ dataFile, distDir: dir, now: () => NOW });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  assert.ok((await call('GET', '/api/teams')).body.teams.length > 0);
  assert.equal(data().teams, undefined);
});

test('POST /api/teams creates a team, with members; names are unique', async () => {
  const r = await call('POST', '/api/teams', { name: 'Ops', color: 'green', icon: 'server', members: ['m2'] });
  assert.equal(r.status, 201);
  const t = r.body.team;
  assert.deepEqual([t.name, t.icon, t.desc], ['Ops', 'server', 'No description yet.']);
  assert.match(t.c, /^#/);
  assert.equal(data().members.find(m => m.id === 'm2').team, t.id);
  assert.equal((await call('POST', '/api/teams', { name: 'ops' })).status, 400);
  for (const body of [{}, { name: 'X', color: 'plaid' }, { name: 'X', members: ['m9'] }, { name: 'X', icon: '<b>' }])
    assert.equal((await call('POST', '/api/teams', body)).status, 400, JSON.stringify(body));
});

test('PATCH /api/teams edits a team and sets its members; DELETE keeps people and projects, teamless', async () => {
  const r = await call('PATCH', '/api/teams/Engineering', { name: 'Eng', desc: 'Ships', members: ['m1'] });
  assert.deepEqual([r.body.team.name, r.body.team.desc], ['Eng', 'Ships']);
  assert.deepEqual(
    data().members.map(m => m.team),
    ['eng', '', ''],
  );
  assert.equal((await call('PATCH', '/api/teams/eng', { name: 'Marketing' })).status, 400);
  assert.equal((await call('DELETE', '/api/teams/eng')).status, 200);
  const d = data();
  assert.deepEqual([d.teams.map(t => t.id), d.members[0].team, d.projects[0].team], [['mkt'], '', '']);
  assert.equal((await call('DELETE', '/api/teams/eng')).status, 404);
});

test('milestones: list, add, change and remove on a project; names are unique, dates are checked', async () => {
  assert.deepEqual((await call('GET', '/api/projects/GR/milestones')).body.milestones, [{ name: 'Beta', date: '2026-11-01' }]);
  const r = await call('POST', '/api/projects/GR/milestones', { name: 'Launch', date: '2026-12-01' });
  assert.equal(r.status, 201);
  assert.deepEqual(r.body.milestone, { name: 'Launch', date: '2026-12-01' });
  assert.equal((await call('POST', '/api/projects/GR/milestones', { name: 'beta', date: '2026-12-02' })).status, 400);
  for (const body of [{ name: 'X' }, { name: 'X', date: '2026-13-01' }, { name: '', date: '2026-12-01' }])
    assert.equal((await call('POST', '/api/projects/GR/milestones', body)).status, 400, JSON.stringify(body));
  const p = await call('PATCH', '/api/projects/GR/milestones/beta', { name: 'Beta 2', date: '2026-11-05' });
  assert.deepEqual(p.body.milestone, { name: 'Beta 2', date: '2026-11-05' });
  assert.equal((await call('DELETE', '/api/projects/GR/milestones/Launch')).status, 200);
  assert.deepEqual(data().projects[0].milestones, [{ name: 'Beta 2', date: '2026-11-05' }]);
  assert.equal((await call('DELETE', '/api/projects/GR/milestones/Launch')).status, 404);
});
