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
    members: [
      { id: 'm1', name: 'Me', team: 'product' },
      { id: 'm2', name: 'Sam', team: 'design' },
    ],
    projects: [
      {
        id: 'p1',
        key: 'GR',
        seq: 0,
        name: 'Tasks',
        icon: 'check-square',
        color: 'indigo',
        status: 'active',
        desc: '',
        due: null,
        start: null,
        members: ['m1'],
      },
      { id: 'p2', key: 'OLD', seq: 4, name: 'Old thing', color: 'slate', status: 'complete', archived: true, members: ['m1'] },
    ],
    projOrder: ['p1', 'p2'],
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

test('GET lists active projects with their details, archived ones only on request', async () => {
  const list = (await call('GET', '/api/projects')).body.projects;
  assert.deepEqual(
    list.map(p => p.key),
    ['GR'],
  );
  assert.deepEqual([list[0].color, list[0].icon, list[0].status], ['indigo', 'check-square', 'active']);
  const all = (await call('GET', '/api/projects?archived=1')).body.projects;
  assert.deepEqual(
    all.map(p => [p.key, !!p.archived]),
    [
      ['GR', false],
      ['OLD', true],
    ],
  );
});

test('GET one project by key or id, case-insensitively, 404 when missing', async () => {
  assert.equal((await call('GET', '/api/projects/gr')).body.project.id, 'p1');
  assert.equal((await call('GET', '/api/projects/p1')).body.project.key, 'GR');
  assert.equal((await call('GET', '/api/projects/old')).body.project.archived, true);
  assert.equal((await call('GET', '/api/projects/NOPE')).status, 404);
});

test('POST creates a project the way the app does and persists it', async () => {
  const r = await call('POST', '/api/projects', { name: 'Website Launch', desc: 'ship it', color: 'teal', icon: 'globe', due: '2026-12-01' });
  assert.equal(r.status, 201);
  const p = r.body.project;
  assert.equal(p.key, 'WL');
  assert.deepEqual([p.name, p.desc, p.color, p.icon, p.due, p.status, p.seq], ['Website Launch', 'ship it', 'teal', 'globe', '2026-12-01', 'planning', 0]);
  assert.deepEqual([p.lead, p.team, p.members, p.milestones, p.fav], ['m1', 'product', ['m1'], [], false]);
  const s = stored();
  assert.equal(s.rev, 2);
  assert.equal(s.state.data.projects.length, 3);
  assert.equal(s.state.data.projOrder[0], p.id);
  assert.equal(s.state.data.activity[0].verb, 'created project');
  const t = await call('POST', '/api/tasks', { title: 'first', project: 'wl' });
  assert.equal(t.body.task.key, 'WL-1');
});

test('POST uses a given key, upper-cases it, and keeps keys unique across archived projects', async () => {
  assert.equal((await call('POST', '/api/projects', { name: 'Mobile', key: 'mob' })).body.project.key, 'MOB');
  assert.equal((await call('POST', '/api/projects', { name: 'Clash', key: 'GR' })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: 'Clash', key: 'old' })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: 'Bad', key: 'x' })).status, 400);
  assert.equal((await call('POST', '/api/projects', { name: 'Bad', key: 'A-B' })).status, 400);
  // a generated key that collides gets disambiguated
  assert.equal((await call('POST', '/api/projects', { name: 'Great Reads' })).body.project.key, 'GRX');
});

test('POST rejects bad input without changing anything', async () => {
  for (const body of [
    {},
    { name: '  ' },
    { name: 'x', status: 'wat' },
    { name: 'x', color: 'puce' },
    { name: 'x', icon: 'Not An Icon' },
    { name: 'x', due: '2026-02-30' },
    { name: 'x', lead: 'nobody' },
    { name: 'x', bogus: 1 },
    { name: 'x', repo: 'not a repo' },
    { name: 'x', repo: 5 },
  ]) {
    const r = await call('POST', '/api/projects', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.ok(r.body.error);
  }
  assert.equal(stored().rev, 1);
});

test('a project links a GitHub repo, given as owner/name or a URL, and null unlinks it', async () => {
  const r = await call('POST', '/api/projects', { name: 'Site', repo: 'https://github.com/buluma/site' });
  assert.equal(r.status, 201);
  assert.equal(r.body.project.repo, 'buluma/site');
  assert.equal((await call('POST', '/api/projects', { name: 'Plain' })).body.project.repo, null);
  assert.equal((await call('PATCH', '/api/projects/gr', { repo: 'buluma/task_manager' })).body.project.repo, 'buluma/task_manager');
  assert.equal((await call('PATCH', '/api/projects/gr', { repo: null })).body.project.repo, null);
  assert.equal((await call('PATCH', '/api/projects/gr', { repo: 'nope' })).status, 400);
});

test('a project is in the Personal or the Work workspace, Personal unless said, and the list can be filtered by it', async () => {
  const work = (await call('POST', '/api/projects', { name: 'Client Portal', workspace: 'work' })).body.project;
  assert.equal(work.workspace, 'work');
  assert.equal((await call('POST', '/api/projects', { name: 'Garden' })).body.project.workspace, 'personal');
  assert.equal((await call('POST', '/api/projects', { name: 'Bad', workspace: 'mars' })).status, 400);
  assert.equal((await call('PATCH', '/api/projects/gr', { workspace: 'work' })).body.project.workspace, 'work');
  assert.equal((await call('PATCH', '/api/projects/gr', { workspace: 'all' })).status, 400);
  const keys = async q => (await call('GET', '/api/projects' + q)).body.projects.map(p => p.key);
  assert.deepEqual(await keys('?workspace=work'), ['GR', 'CP']);
  assert.deepEqual(await keys('?workspace=personal'), ['GAR']);
  assert.equal((await call('GET', '/api/projects?workspace=mars')).status, 400);
});

test('PATCH updates fields, logs a status change, and refuses to change the key', async () => {
  const r = await call('PATCH', '/api/projects/gr', { name: 'Everything', status: 'risk', color: 'rose', desc: 'x', due: '2026-11-30', lead: 'm2' });
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.project.name, r.body.project.status, r.body.project.lead, r.body.project.due], ['Everything', 'risk', 'm2', '2026-11-30']);
  const s = stored().state.data;
  assert.equal(s.activity[0].verb, 'changed status of project');
  assert.equal(s.activity[0].extra, 'to At Risk');
  assert.ok(s.projects[0].members.includes('m2'));
  assert.equal((await call('PATCH', '/api/projects/gr', { key: 'ZZ' })).status, 400);
  assert.equal((await call('PATCH', '/api/projects/gr', {})).status, 400);
  assert.equal((await call('PATCH', '/api/projects/nope', { name: 'x' })).status, 404);
});

test('DELETE archives the project and keeps its tasks; PATCH archived:false restores it', async () => {
  await call('POST', '/api/tasks', { title: 'keep me' });
  const r = await call('DELETE', '/api/projects/gr');
  assert.equal(r.status, 200);
  assert.equal(r.body.project.archived, true);
  let s = stored().state.data;
  assert.equal(s.tasks.length, 1);
  assert.ok(s.projects[0].archivedAt);
  assert.deepEqual((await call('GET', '/api/projects')).body.projects, []);
  const back = await call('PATCH', '/api/projects/gr', { archived: false });
  assert.equal(back.status, 200);
  s = stored().state.data;
  assert.deepEqual([s.projects[0].archived, s.projects[0].archivedAt], [false, null]);
  assert.equal((await call('GET', '/api/projects')).body.projects.length, 1);
});

test('unsupported methods are 405', async () => {
  assert.equal((await call('PUT', '/api/projects', {})).status, 405);
  assert.equal((await call('POST', '/api/projects/gr', {})).status, 405);
});

test('DELETE ?purge=1 permanently removes an archived project with its tasks and comments', async () => {
  await call('POST', '/api/projects', { name: 'Doomed', key: 'DM' });
  await call('POST', '/api/tasks', { title: 'in doomed', project: 'DM' });
  await call('POST', '/api/tasks', { title: 'safe', project: 'GR' });
  const s = stored();
  const doomed = s.state.data.projects.find(p => p.key === 'DM');
  const inDoomed = s.state.data.tasks.find(t => t.project === doomed.id);
  s.state.data.comments = [{ id: 'c1', task: inDoomed.id }];
  fs.writeFileSync(dataFile, JSON.stringify(s));
  await server.close();
  server = createApp({ dataFile, distDir: dir, now: () => new Date(2026, 9, 17, 12, 0, 0) });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;

  const early = await call('DELETE', '/api/projects/DM?purge=1');
  assert.equal(early.status, 409, 'must be archived first');
  await call('DELETE', '/api/projects/DM');
  const r = await call('DELETE', '/api/projects/DM?purge=1');
  assert.equal(r.status, 200);
  assert.deepEqual([r.body.project.key, r.body.tasks], ['DM', 1]);
  const d = stored().state.data;
  assert.equal(
    d.projects.some(p => p.key === 'DM'),
    false,
  );
  assert.equal(d.projOrder.includes(doomed.id), false);
  assert.deepEqual(
    d.tasks.map(t => t.title),
    ['safe'],
  );
  assert.deepEqual(d.comments, []);
  assert.equal(
    d.activity.some(a => a.project === doomed.id),
    false,
    'activity rows for the project go too: the Activity page crashes on a project that no longer exists',
  );
  assert.ok(
    d.activity.some(a => a.project === 'p1'),
    'activity of other projects stays',
  );
  assert.equal((await call('GET', '/api/projects/DM')).status, 404);
  assert.equal((await call('DELETE', '/api/projects/GR?purge=1')).status, 409, 'an active project cannot be purged');
});
