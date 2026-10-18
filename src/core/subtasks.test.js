import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addSub, removeSub, renameSub, setSubDone } from './subtasks.js';

const NOW = 1000;
const state = () => ({ activity: [], tasks: [{ id: 't1', project: 'p1', subtasks: [{ id: 's1', title: 'Outline', done: false }], updated: 1 }] });
let n = 0;
const ctx = { by: 'm2', now: NOW, newId: p => p + ++n };

test('addSub appends an open subtask and logs it as the actor', () => {
  const d = state();
  const s = addSub(d, d.tasks[0], 'Draft', ctx);
  assert.deepEqual(d.tasks[0].subtasks.at(-1), { id: s.id, title: 'Draft', done: false });
  assert.match(s.id, /^s/);
  assert.match(d.activity[0].id, /^a/);
  assert.deepEqual(d.activity[0], { id: d.activity[0].id, by: 'm2', verb: 'added subtask to', task: 't1', project: 'p1', at: NOW, extra: '“Draft”' });
  assert.equal(d.tasks[0].updated, NOW);
});

test('addSub never reuses an id already on the task, and starts the list on a task without one', () => {
  const d = state();
  const ids = ['s1', 's1', 's9'];
  const s = addSub(d, d.tasks[0], 'Draft', { ...ctx, newId: () => ids.shift() });
  assert.equal(s.id, 's9');
  const bare = { id: 't2', project: 'p1' };
  addSub(d, bare, 'First', ctx);
  assert.equal(bare.subtasks.length, 1);
});

test('setSubDone logs completing and reopening, and does nothing when the state is unchanged', () => {
  const d = state();
  const [t, s] = [d.tasks[0], d.tasks[0].subtasks[0]];
  setSubDone(d, t, s, true, ctx);
  assert.deepEqual([s.done, d.activity[0].verb, d.activity[0].extra], [true, 'completed subtask on', '“Outline”']);
  setSubDone(d, t, s, false, ctx);
  assert.equal(d.activity[0].verb, 'reopened subtask on');
  setSubDone(d, t, s, false, ctx);
  assert.equal(d.activity.length, 2);
});

test('renameSub and removeSub change the task without logging', () => {
  const d = state();
  const [t, s] = [d.tasks[0], d.tasks[0].subtasks[0]];
  renameSub(t, s, 'Outline v2', NOW);
  assert.deepEqual([s.title, t.updated], ['Outline v2', NOW]);
  t.updated = 1;
  removeSub(t, s, NOW);
  assert.deepEqual([t.subtasks, t.updated], [[], NOW]);
  assert.equal(d.activity.length, 0);
});
