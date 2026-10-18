import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TEAMS_SEED } from './constants.js';
import { addMembers, nameFromEmail, removeMember } from './members.js';
import { addTeam, removeTeam, setTeamMembers, teamsOf } from './teams.js';

let n = 0;
const newId = p => p + ++n;
const state = () => ({
  me: 'm1',
  members: [
    { id: 'm1', name: 'Me', email: 'me@x.io', team: 'eng' },
    { id: 'm2', name: 'Ada', email: 'ada@x.io', team: 'eng' },
  ],
  projects: [{ id: 'p1', team: 'eng', members: ['m1', 'm2'] }],
  tasks: [
    { id: 't1', assignee: 'm2', status: 'todo' },
    { id: 't2', assignee: 'm2', status: 'done' },
    { id: 't3', assignee: 'm1', status: 'todo' },
  ],
});

test('nameFromEmail turns the part before @ into words', () => {
  assert.equal(nameFromEmail('grace.hopper@navy.mil'), 'Grace Hopper');
  assert.equal(nameFromEmail('j_doe-smith@x.io'), 'J Doe Smith');
});

test('addMembers adds each new address once, with the role and team given, and skips known ones', () => {
  const d = state();
  const added = addMembers(d, ['new@x.io', 'ada@x.io', 'new@x.io'], { role: 'Guest', team: 'mkt' }, newId);
  assert.equal(added.length, 1);
  assert.deepEqual(
    { ...added[0], id: undefined },
    { id: undefined, name: 'New', email: 'new@x.io', role: 'Guest', team: 'mkt', title: 'Guest', c: '#6B7280', status: 'active', last: null, tz: '—' },
  );
  assert.equal(d.members.length, 3);
});

test('removeMember drops the member, unassigns their tasks and takes them off projects', () => {
  const d = state();
  removeMember(d, d.members[1]);
  assert.deepEqual(
    d.members.map(m => m.id),
    ['m1'],
  );
  assert.deepEqual(
    d.tasks.map(t => t.assignee),
    [null, null, 'm1'],
  );
  assert.deepEqual(d.projects[0].members, ['m1']);
});

test('teamsOf seeds the default teams the first time, as the app does', () => {
  const d = state();
  assert.deepEqual(
    teamsOf(d).map(t => t.id),
    TEAMS_SEED.map(t => t.id),
  );
  assert.notEqual(d.teams[0], TEAMS_SEED[0]);
});

test('addTeam, setTeamMembers and removeTeam keep members and projects in step', () => {
  const d = state();
  const t = addTeam(d, { name: 'Ops', desc: '', icon: 'server', c: '#111' }, newId);
  assert.deepEqual({ ...t, id: undefined }, { id: undefined, name: 'Ops', desc: 'No description yet.', icon: 'server', c: '#111' });
  setTeamMembers(d, t, ['m2']);
  assert.deepEqual(
    d.members.map(m => m.team),
    ['eng', t.id],
  );
  setTeamMembers(d, t, ['m1']);
  assert.deepEqual(
    d.members.map(m => m.team),
    [t.id, ''],
  );
  d.projects[0].team = t.id;
  removeTeam(d, t);
  assert.ok(!d.teams.includes(t));
  assert.deepEqual([d.members[0].team, d.projects[0].team], ['', '']);
});
