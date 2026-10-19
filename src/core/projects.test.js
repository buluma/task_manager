import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addProject, changeProject, makeKey } from './projects.js';

const NOW = 1000;
let n = 0;
const ctx = { by: 'm2', now: NOW, newId: p => p + ++n };
const state = () => ({
  me: 'm1',
  members: [
    { id: 'm1', name: 'Me' },
    { id: 'm2', name: 'Ada' },
  ],
  projects: [{ id: 'p1', key: 'GR', name: 'Tasks', status: 'active', lead: 'm1', members: ['m1'] }],
  projOrder: ['p1'],
  activity: [],
});

test('makeKey takes initials, pads short ones from the letters, and adds X until it is unique', () => {
  const d = state();
  assert.equal(makeKey(d, 'Home Lab'), 'HL');
  assert.equal(makeKey(d, 'Gr'), 'GR' + 'X');
  assert.equal(makeKey(d, 'Seacom'), 'SEA');
  assert.equal(makeKey(d, '42'), 'PRJ');
});

test('addProject keys the project, starts its task counter at 0, puts it first and logs it', () => {
  const d = state();
  const p = addProject(
    d,
    { name: 'Home Lab', icon: 'server', color: 'teal', status: 'planning', team: 'eng', lead: 'm2', due: null, start: '2026-10-19', desc: '' },
    ctx,
  );
  assert.deepEqual(
    { ...p, id: undefined },
    {
      id: undefined,
      key: 'HL',
      seq: 0,
      name: 'Home Lab',
      icon: 'server',
      color: 'teal',
      status: 'planning',
      team: 'eng',
      lead: 'm2',
      due: null,
      start: '2026-10-19',
      fav: false,
      members: ['m1', 'm2'],
      desc: '',
      milestones: [],
      last: 0,
    },
  );
  assert.equal(d.projOrder[0], p.id);
  assert.deepEqual(d.activity[0], { id: d.activity[0].id, by: 'm2', verb: 'created project', task: null, project: p.id, at: NOW, extra: '' });
  assert.equal(addProject(d, { name: 'X', key: 'ZZ' }, ctx).key, 'ZZ');
});

test('changeProject applies what changed, adds a new lead to the members and logs a status change', () => {
  const d = state();
  const p = d.projects[0];
  changeProject(d, p, { name: 'Tasks', lead: 'm2', status: 'risk', desc: 'Late' }, ctx);
  assert.deepEqual([p.lead, p.members, p.status, p.desc], ['m2', ['m1', 'm2'], 'risk', 'Late']);
  assert.deepEqual(
    d.activity.map(a => [a.verb, a.extra, a.task]),
    [['changed status of project', 'to At Risk', null]],
  );
  changeProject(d, p, { status: 'risk' }, ctx);
  assert.equal(d.activity.length, 1);
});

test('changeProject archives and restores through the archive', () => {
  const d = state();
  const p = d.projects[0];
  changeProject(d, p, { archived: true }, ctx);
  assert.deepEqual([p.archived, p.archivedAt], [true, NOW]);
  changeProject(d, p, { archived: false }, ctx);
  assert.deepEqual([p.archived, p.archivedAt], [false, null]);
});
