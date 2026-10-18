/* The server re-implements the app's task actions (see the headers of tasks.js). These tests run the same change
   through both, on the same state at the same moment, and compare the results, so the two cannot drift apart
   without a test failing. Only the app functions that do not need the DOM can be called here: createTask,
   applyPatch and deleteTasks in src/actions/actions.js. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createTask, patchTask, removeTasks } from './tasks.js';

// actions.js pulls in the whole UI: give it the Vite-only icon module and the few browser globals it touches on import.
registerHooks({
  resolve: (spec, ctx, next) => (spec === 'virtual:icons' ? { url: 'data:text/javascript,export const ICONS = {}', shortCircuit: true } : next(spec, ctx)),
});
const inert = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : inert), apply: () => inert });
Object.assign(globalThis, { document: inert, addEventListener() {}, matchMedia: inert, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });
const app = await import('../src/actions/actions.js');
const { S, task } = await import('../src/core/store.js');

const NOW = new Date(2026, 9, 18, 9, 0).getTime();
const TODAY = '2026-10-18';
const PREFS = { weekStart: 1 };

const fixture = () => ({
  me: 'm1',
  members: [
    { id: 'm1', name: 'Me' },
    { id: 'm2', name: 'Ada' },
  ],
  projects: [
    { id: 'p1', key: 'GR', name: 'Tasks', seq: 2, members: ['m1'], archived: false },
    { id: 'p2', key: 'OPS', name: 'Ops', seq: 7, members: ['m1'], archived: false },
  ],
  projOrder: ['p1', 'p2'],
  tasks: [
    {
      id: 't1',
      key: 'GR-1',
      project: 'p1',
      title: 'Write the report',
      status: 'todo',
      assignee: 'm1',
      priority: 'none',
      due: '2026-10-20',
      start: null,
      labels: [],
      subtasks: [{ id: 's1', title: 'Outline', done: true }],
      deps: [],
      desc: '',
      estimate: null,
      cycle: null,
      fav: false,
      recur: null,
      created: 1,
      updated: 1,
      order: 1,
    },
    {
      id: 't2',
      key: 'GR-2',
      project: 'p1',
      title: 'Send it',
      status: 'backlog',
      assignee: null,
      priority: 'high',
      due: null,
      start: null,
      labels: ['ops'],
      subtasks: [],
      deps: ['t1'],
      desc: '',
      estimate: null,
      cycle: null,
      fav: false,
      recur: null,
      created: 2,
      updated: 2,
      order: 2,
    },
  ],
  comments: [{ id: 'c1', task: 't1', by: 'm1', at: 3, text: 'First draft is up', re: {} }],
  activity: [],
  notifs: [],
});

/* Ids are random on both sides, so tasks are compared by key and activity rows without their id. */
function normalize(data) {
  const keyOf = id => data.tasks.find(t => t.id === id)?.key ?? id;
  const without = (o, k) => {
    const c = { ...o };
    delete c[k];
    return c;
  };
  return {
    ...data,
    tasks: data.tasks.map(t => ({ ...without(t, 'id'), deps: t.deps.map(keyOf) })),
    comments: data.comments.map(c => ({ ...c, task: keyOf(c.task) })),
    activity: data.activity.map(a => ({ ...without(a, 'id'), task: keyOf(a.task) })),
  };
}

function viaApp(fn) {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    S.data = fixture();
    fn();
    return normalize(S.data);
  } finally {
    mock.timers.reset();
  }
}
function viaServer(fn) {
  const data = fixture();
  fn(data);
  return normalize(data);
}

/* One field change, made in the app's task drawer and through PATCH /api/tasks/GR-1. */
const patchCase = (name, patch) =>
  test(`patch parity: ${name}`, () => {
    const a = viaApp(() => app.applyPatch(task('t1'), patch));
    const s = viaServer(d => patchTask(d, PREFS, TODAY, 'GR-1', patch, NOW));
    assert.deepEqual(s, a);
  });

patchCase('moving to another status', { status: 'progress' });
patchCase('completing', { status: 'done' });
patchCase('cancelling', { status: 'cancelled' });
patchCase('assigning', { assignee: 'm2' });
patchCase('unassigning', { assignee: null });
patchCase('changing priority', { priority: 'urgent' });
patchCase('clearing the due date', { due: null });
patchCase('clearing the start date', { start: null });
patchCase('renaming', { title: 'Write the final report' });
patchCase('setting labels', { labels: ['writing'] });
patchCase('estimating', { estimate: '3' });
patchCase('adding to a cycle', { cycle: '2026-10-12' });
patchCase('moving to another project', { project: 'p2' });
patchCase('setting the due date', { due: '2026-10-25' });
patchCase('setting the start date', { start: '2026-10-19' });
patchCase('setting a repeat', { recur: 'Weekly' });

test('patch parity: completing a repeating task schedules the next one', () => {
  const setup = d => Object.assign(d.tasks[0], { recur: 'Weekly' });
  const a = viaApp(() => {
    setup(S.data);
    app.applyPatch(task('t1'), { status: 'done' });
  });
  const s = viaServer(d => {
    setup(d);
    patchTask(d, PREFS, TODAY, 'GR-1', { status: 'done' }, NOW);
  });
  assert.deepEqual(s, a);
});

test('create parity: a task with every field given', () => {
  const fields = {
    title: 'Plan the launch',
    status: 'progress',
    assignee: 'm2',
    priority: 'medium',
    due: '2026-10-30',
    start: '2026-10-19',
    labels: ['launch'],
    estimate: '5',
    cycle: '2026-10-12',
    recur: null,
  };
  const a = viaApp(() => app.createTask({ ...fields, project: 'p2' }));
  const s = viaServer(d => createTask(d, PREFS, TODAY, { ...fields, project: 'OPS' }, NOW));
  assert.deepEqual(s, a);
});

test('delete parity: the task, links to it and its comments go', () => {
  const a = viaApp(() => app.deleteTasks(['t1']));
  const s = viaServer(d => removeTasks(d, ['t1']));
  assert.deepEqual(s, a);
});
