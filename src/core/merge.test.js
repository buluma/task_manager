import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeState } from './merge.js';

const task = (id, extra = {}) => ({ id, key: `GR-${id.slice(1)}`, project: 'p1', title: id, status: 'todo', labels: [], ...extra });
const ws = (tasks, extra = {}) => ({
  data: { projects: [{ id: 'p1', key: 'GR', seq: 2 }], tasks, activity: [], projOrder: ['p1'], ...extra },
  prefs: { theme: 'system' },
  views: {},
  collapsed: false,
});
const copy = v => JSON.parse(JSON.stringify(v));

test('a side that changed nothing takes the other side whole', () => {
  const base = ws([task('t1'), task('t2')]);
  const theirs = copy(base);
  theirs.data.tasks[0].status = 'done';
  assert.deepEqual(mergeState(base, copy(base), theirs), { state: theirs, conflicts: [] });
  const mine = copy(base);
  mine.prefs.theme = 'dark';
  assert.deepEqual(mergeState(base, mine, copy(base)), { state: mine, conflicts: [] });
});

test('edits to different tasks, or different fields of one task, both survive', () => {
  const base = ws([task('t1'), task('t2')]);
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.tasks[0].status = 'progress';
  mine.data.tasks[1].title = 'renamed by me';
  theirs.data.tasks[1].status = 'done';
  const { state, conflicts } = mergeState(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.equal(state.data.tasks[0].status, 'progress');
  assert.equal(state.data.tasks[1].title, 'renamed by me');
  assert.equal(state.data.tasks[1].status, 'done');
});

test('the same field changed on both sides keeps theirs and reports where', () => {
  const base = ws([task('t1')]);
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.tasks[0].status = 'review';
  theirs.data.tasks[0].status = 'done';
  mine.data.tasks[0].labels = ['Bug'];
  theirs.data.tasks[0].labels = ['Docs'];
  const { state, conflicts } = mergeState(base, mine, theirs);
  assert.equal(state.data.tasks[0].status, 'done');
  assert.deepEqual(state.data.tasks[0].labels, ['Docs']);
  assert.deepEqual(conflicts, [
    ['data', 'tasks', 't1', 'status'],
    ['data', 'tasks', 't1', 'labels'],
  ]);
});

test('records added on both sides are all kept: newest-first lists get mine in front, appended lists at the end', () => {
  const base = ws([task('t1')], { activity: [{ id: 'a1' }] });
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.activity.unshift({ id: 'a-mine' });
  theirs.data.activity.unshift({ id: 'a-theirs' });
  mine.data.tasks.push(task('t-mine'));
  theirs.data.tasks.push(task('t-theirs', { key: 'GR-9' }));
  const { state, conflicts } = mergeState(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(
    state.data.activity.map(a => a.id),
    ['a-mine', 'a-theirs', 'a1'],
  );
  assert.deepEqual(
    state.data.tasks.map(t => t.id),
    ['t1', 't-theirs', 't-mine'],
  );
});

test('a delete wins over an untouched record, but not over an edit', () => {
  const base = ws([task('t1'), task('t2'), task('t3')]);
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.tasks = mine.data.tasks.filter(t => t.id !== 't1'); // I delete t1; they leave it alone
  theirs.data.tasks = theirs.data.tasks.filter(t => t.id !== 't2'); // they delete t2 ...
  mine.data.tasks.find(t => t.id === 't2').title = 'still working on it'; // ... which I edited
  const { state, conflicts } = mergeState(base, mine, theirs);
  assert.deepEqual(
    state.data.tasks.map(t => [t.id, t.title]),
    [
      ['t2', 'still working on it'],
      ['t3', 't3'],
    ],
  );
  assert.deepEqual(conflicts, [['data', 'tasks', 't2']]);
});

test('tasks created on both sides with the same key: mine is re-keyed after theirs', () => {
  const base = ws([task('t1')]);
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.projects[0].seq = 3;
  mine.data.tasks.push(task('tm', { key: 'GR-3' }));
  theirs.data.projects[0].seq = 4;
  theirs.data.tasks.push(task('ta', { key: 'GR-3' }), task('tb', { key: 'GR-4' }));
  const { state, conflicts } = mergeState(base, mine, theirs);
  assert.deepEqual(conflicts, []);
  assert.deepEqual(
    state.data.tasks.map(t => [t.id, t.key]),
    [
      ['t1', 'GR-1'],
      ['ta', 'GR-3'],
      ['tb', 'GR-4'],
      ['tm', 'GR-5'],
    ],
  );
  assert.equal(state.data.projects[0].seq, 5);
});

test('lists without ids (an order, tags) changed on both sides keep theirs', () => {
  const base = ws([], { projOrder: ['p1', 'p2'] });
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.projOrder = ['p2', 'p1'];
  theirs.data.projOrder = ['p1', 'p2', 'p3'];
  const { state, conflicts } = mergeState(base, mine, theirs);
  assert.deepEqual(state.data.projOrder, ['p1', 'p2', 'p3']);
  assert.deepEqual(conflicts, [['data', 'projOrder']]);
});

test('the inputs are left untouched', () => {
  const base = ws([task('t1')]);
  const mine = copy(base);
  const theirs = copy(base);
  mine.data.tasks[0].status = 'done';
  theirs.data.tasks.push(task('t2'));
  const before = copy([base, mine, theirs]);
  const { state } = mergeState(base, mine, theirs);
  state.data.tasks[0].title = 'mutated';
  assert.deepEqual([base, mine, theirs], before);
});
