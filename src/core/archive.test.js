import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveProject, archiveTask, removeProject, removeTasks, restoreProject, restoreTask } from './archive.js';

const NOW = 1000;
const ctx = { by: 'm2', now: NOW, newId: p => p + 'x' };
const state = () => ({
  projects: [
    { id: 'p1', key: 'GR' },
    { id: 'p2', key: 'OPS' },
  ],
  projOrder: ['p1', 'p2'],
  tasks: [
    { id: 't1', project: 'p1', deps: [], updated: 1 },
    { id: 't2', project: 'p1', deps: ['t1'], archived: true },
    { id: 't3', project: 'p2', deps: ['t1', 't2'] },
  ],
  comments: [
    { id: 'c1', task: 't1' },
    { id: 'c2', task: 't3' },
  ],
  activity: [
    { id: 'a1', project: 'p1', task: 't1' },
    { id: 'a2', project: 'p2', task: 't3' },
  ],
});

test('archiveTask stamps and logs the task once', () => {
  const d = state();
  archiveTask(d, d.tasks[0], ctx);
  assert.deepEqual([d.tasks[0].archived, d.tasks[0].archivedAt, d.tasks[0].updated], [true, NOW, NOW]);
  assert.deepEqual([d.activity[0].verb, d.activity[0].by], ['archived', 'm2']);
  archiveTask(d, d.tasks[0], { ...ctx, now: 2000 });
  assert.deepEqual([d.tasks[0].archivedAt, d.activity.length], [NOW, 3]);
});

test('restoreTask clears the archive and logs it, only for an archived task', () => {
  const d = state();
  restoreTask(d, d.tasks[1], ctx);
  assert.deepEqual([d.tasks[1].archived, d.tasks[1].archivedAt, d.activity[0].verb], [false, null, 'restored']);
  restoreTask(d, d.tasks[1], ctx);
  assert.equal(d.activity.length, 3);
});

test('removeTasks takes the tasks, the dependency links to them and their comments', () => {
  const d = state();
  removeTasks(d, ['t1']);
  assert.deepEqual(
    d.tasks.map(t => [t.id, t.deps]),
    [
      ['t2', []],
      ['t3', ['t2']],
    ],
  );
  assert.deepEqual(
    d.comments.map(c => c.id),
    ['c2'],
  );
});

test('archiveProject stamps once and restoreProject clears it', () => {
  const p = { id: 'p1' };
  archiveProject(p, NOW);
  archiveProject(p, 2000);
  assert.deepEqual(p, { id: 'p1', archived: true, archivedAt: NOW });
  restoreProject(p);
  assert.deepEqual(p, { id: 'p1', archived: false, archivedAt: null });
});

test('removeProject takes the project, all its tasks (archived ones too) and its activity, and counts the tasks', () => {
  const d = state();
  assert.equal(removeProject(d, d.projects[0]), 2);
  assert.deepEqual(
    d.projects.map(p => p.id),
    ['p2'],
  );
  assert.deepEqual(d.projOrder, ['p2']);
  assert.deepEqual(
    d.tasks.map(t => [t.id, t.deps]),
    [['t3', []]],
  );
  assert.deepEqual(
    d.comments.map(c => c.id),
    ['c2'],
  );
  assert.deepEqual(
    d.activity.map(a => a.id),
    ['a2'],
  );
});
