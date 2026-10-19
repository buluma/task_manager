import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addTask, changeTask, nextKey } from './tasks.js';

const NOW = 1000;
let n = 0;
const ctx = { by: 'm2', now: NOW, newId: p => p + ++n };
const state = () => ({
  me: 'm1',
  members: [
    { id: 'm1', name: 'Me' },
    { id: 'm2', name: 'Ada' },
  ],
  projects: [
    { id: 'p1', key: 'GR', name: 'Tasks', seq: 4 },
    { id: 'p2', key: 'OPS', name: 'Ops' },
  ],
  tasks: [
    {
      id: 't1',
      key: 'GR-4',
      project: 'p1',
      title: 'Report',
      status: 'todo',
      assignee: null,
      priority: 'none',
      due: '2026-10-20',
      start: null,
      labels: [],
      subtasks: [{ id: 's1', title: 'a', done: true }],
      deps: [],
      recur: null,
      order: 3,
      created: 1,
      updated: 1,
    },
  ],
  activity: [],
});

test('nextKey counts on from the project counter, starting after 200 for a project without one', () => {
  const d = state();
  assert.equal(nextKey(d.projects[0]), 'GR-5');
  assert.equal(nextKey(d.projects[1]), 'OPS-201');
});

test('addTask fills the defaults, keys it from its project, puts it last and logs it', () => {
  const d = state();
  const t = addTask(d, d.projects[1], { title: 'Plan', status: 'backlog' }, ctx);
  assert.deepEqual(
    { ...t, id: undefined },
    {
      id: undefined,
      title: 'Plan',
      status: 'backlog',
      assignee: null,
      priority: 'none',
      due: null,
      start: null,
      labels: [],
      subtasks: [],
      deps: [],
      desc: '',
      estimate: null,
      fav: false,
      recur: null,
      created: NOW,
      updated: NOW,
      order: 4,
      project: 'p2',
      key: 'OPS-201',
    },
  );
  assert.deepEqual([d.activity[0].verb, d.activity[0].by, d.activity[0].task], ['created', 'm2', t.id]);
});

test('addTask keeps an id and key the caller gives, and never reuses a task id', () => {
  const d = state();
  assert.deepEqual([addTask(d, d.projects[0], { id: 'tX', key: 'GR-99' }, ctx).id, d.tasks.at(-1).key], ['tX', 'GR-99']);
  const ids = ['t1', 't7'];
  assert.equal(addTask(d, d.projects[0], {}, { ...ctx, newId: p => (p === 't' ? ids.shift() : p + ++n) }).id, 't7');
});

test('changeTask logs each change the way the activity feed shows it, and skips what did not change', () => {
  const d = state();
  const { changed } = changeTask(
    d,
    d.tasks[0],
    {
      title: 'Report',
      assignee: 'm2',
      priority: 'high',
      due: null,
      start: '2026-10-19',
      labels: ['x'],
      estimate: '3',
      cycle: '2026-10-12',
      recur: 'Weekly',
      deps: ['t9'],
    },
    ctx,
  );
  assert.deepEqual(d.activity.map(a => [a.verb, a.extra]).reverse(), [
    ['assigned', 'to Ada'],
    ['changed priority of', 'to High'],
    ['changed due date of', '(cleared)'],
    ['changed start date of', 'to 2026-10-19'],
    ['updated labels on', ''],
    ['estimated', '3'],
    ['added to this cycle', ''],
    ['set repeat on', 'weekly'],
    ['updated dependencies of', ''],
  ]);
  assert.deepEqual(
    changed.map(c => c.field),
    ['assignee', 'priority', 'due', 'start', 'labels', 'estimate', 'cycle', 'recur', 'deps'],
  );
  assert.equal(d.tasks[0].updated, NOW);
});

test('completing stamps the task and remembers where it was; moving logs from and to', () => {
  const d = state();
  const r = changeTask(d, d.tasks[0], { status: 'progress' }, ctx);
  assert.deepEqual([d.activity[0].verb, d.activity[0].extra, r.changed[0].from], ['moved', 'from To Do to In Progress', 'todo']);
  changeTask(d, d.tasks[0], { status: 'done' }, ctx);
  assert.deepEqual([d.tasks[0].completedAt, d.tasks[0].prevStatus, d.activity[0].verb], [NOW, 'progress', 'completed']);
});

test('completing a repeating task with a due date schedules a fresh copy, unless it is archived', () => {
  const d = state();
  d.tasks[0].recur = 'Weekly';
  const { next } = changeTask(d, d.tasks[0], { status: 'done' }, ctx);
  assert.deepEqual(
    [next.key, next.status, next.due, next.start, next.created, next.order, next.subtasks[0].done, 'completedAt' in next, 'prevStatus' in next],
    ['GR-5', 'todo', '2026-10-27', '2026-10-27', NOW, 4, false, false, false],
  );
  assert.deepEqual(
    d.activity.map(a => a.verb),
    ['created', 'completed'],
  );
  const e = state();
  Object.assign(e.tasks[0], { recur: 'Weekly', archived: true });
  assert.equal(changeTask(e, e.tasks[0], { status: 'done' }, ctx).next, undefined);
});

test('moving to another project re-keys the task from that project; archived goes through archive and restore', () => {
  const d = state();
  changeTask(d, d.tasks[0], { project: 'p2' }, ctx);
  assert.deepEqual([d.tasks[0].key, d.activity[0].extra], ['OPS-201', 'to Ops']);
  changeTask(d, d.tasks[0], { archived: true }, ctx);
  assert.deepEqual([d.tasks[0].archived, d.activity[0].verb], [true, 'archived']);
  changeTask(d, d.tasks[0], { archived: false }, ctx);
  assert.deepEqual([d.tasks[0].archived, d.activity[0].verb], [false, 'restored']);
});
