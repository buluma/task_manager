import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addComment, editComment, removeComment } from './comments.js';

const NOW = 1000;
const state = () => ({
  activity: [],
  comments: [{ id: 'c1', task: 't1', by: 'm1', at: 3, text: 'First', re: {} }],
  tasks: [{ id: 't1', project: 'p1', updated: 1 }],
});
let n = 0;
const ctx = { by: 'm2', now: NOW, newId: p => p + ++n };

test('addComment stores the comment as the actor, stamped now, and logs it', () => {
  const d = state();
  const c = addComment(d, d.tasks[0], 'Looks good', ctx);
  assert.deepEqual(d.comments.at(-1), { id: c.id, task: 't1', by: 'm2', at: NOW, text: 'Looks good', re: {} });
  assert.match(c.id, /^c/);
  assert.deepEqual(d.activity[0], { id: d.activity[0].id, by: 'm2', verb: 'commented on', task: 't1', project: 'p1', at: NOW, extra: '' });
  assert.equal(d.tasks[0].updated, NOW);
});

test('a backdated comment keeps its date and is not logged as new activity', () => {
  const d = state();
  const c = addComment(d, d.tasks[0], 'From the old tracker', ctx, { at: 500 });
  assert.equal(c.at, 500);
  assert.deepEqual([d.activity.length, d.tasks[0].updated], [0, 1]);
});

test('addComment never reuses a comment id, and starts the list on a state without one', () => {
  const d = state();
  const ids = ['c1', 'c7'];
  assert.equal(addComment(d, d.tasks[0], 'x', { ...ctx, newId: p => (p === 'c' ? ids.shift() : p + ++n) }).id, 'c7');
  const bare = { activity: [], tasks: [{ id: 't1', project: 'p1' }] };
  addComment(bare, bare.tasks[0], 'x', ctx);
  assert.equal(bare.comments.length, 1);
});

test('removeComment drops that comment only, without logging', () => {
  const d = state();
  const keep = addComment(d, d.tasks[0], 'Second', ctx);
  removeComment(d, d.comments[0]);
  assert.deepEqual(
    d.comments.map(c => c.id),
    [keep.id],
  );
  assert.equal(d.activity.length, 1);
});

test('editComment changes only the text: same id, author, time and reactions, and nothing logged', () => {
  const d = state();
  const before = { ...d.comments[0] };
  editComment(d.comments[0], 'First, fixed');
  assert.deepEqual(d.comments[0], { ...before, text: 'First, fixed' });
  assert.deepEqual([d.activity.length, d.tasks[0].updated], [0, 1]);
});
