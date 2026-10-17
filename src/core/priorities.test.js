import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ScaleError, addLevel, normalizePriorities, patchLevel, removeLevel, scaleOf } from './priorities.js';
import { applyPriorities, prBars } from './constants.js';

const data = () => ({ tasks: [], priorities: undefined });

test('scaleOf is the default scale until the workspace has its own', () => {
  assert.deepEqual(
    scaleOf(data()).map(p => p.id),
    ['urgent', 'high', 'medium', 'low', 'none'],
  );
});

test('addLevel validates, copies the defaults into the state and appends', () => {
  const d = data();
  assert.deepEqual(addLevel(d, { name: ' Blocker ', w: 5 }), { id: 'blocker', name: 'Blocker', w: 5 });
  assert.equal(d.priorities.length, 6);
  for (const input of [
    {},
    { name: 'x' },
    { name: 'x', w: 0 },
    { name: 'x', w: 1.5 },
    { name: 'x', w: 100 },
    { name: 'high', w: 3 },
    { name: 'x', id: 'A b', w: 1 },
    null,
    [],
  ])
    assert.throws(
      () => addLevel(d, input),
      e => e instanceof ScaleError && e.status === 400,
      JSON.stringify(input),
    );
  assert.equal(d.priorities.length, 6, 'rejected input changes nothing');
});

test('patchLevel renames and reweights, but none keeps weight 0', () => {
  const d = data();
  assert.deepEqual(patchLevel(d, 'low', { name: 'Someday', w: 7 }), { id: 'low', name: 'Someday', w: 7 });
  assert.throws(() => patchLevel(d, 'none', { w: 2 }), ScaleError);
  assert.throws(
    () => patchLevel(d, 'nope', { name: 'x' }),
    e => e.status === 404,
  );
  assert.equal(d.priorities.find(p => p.id === 'none').w, 0);
});

test('removeLevel moves tasks, refuses none and bad replacements, and returns how many moved', () => {
  const d = data();
  d.tasks = [{ priority: 'low' }, { priority: 'low' }, { priority: 'high' }];
  assert.equal(removeLevel(d, 'low', 'medium', 5), 2);
  assert.deepEqual(
    d.tasks.map(t => t.priority),
    ['medium', 'medium', 'high'],
  );
  assert.throws(() => removeLevel(d, 'none'), ScaleError);
  assert.throws(() => removeLevel(d, 'high', 'high'), ScaleError);
  assert.throws(() => removeLevel(d, 'high', 'low'), ScaleError, 'low was already removed');
});

test('bars scale to the levels in use: defaults keep 1, 2 and 3 bars', () => {
  applyPriorities(undefined);
  assert.deepEqual(['low', 'medium', 'high'].map(prBars), [1, 2, 3]);
  applyPriorities([
    { id: 'a', name: 'A', w: 1 },
    { id: 'b', name: 'B', w: 2 },
    { id: 'c', name: 'C', w: 3 },
    { id: 'd', name: 'D', w: 4 },
    { id: 'e', name: 'E', w: 5 },
    { id: 'none', name: 'No priority', w: 0 },
  ]);
  assert.deepEqual(['a', 'b', 'c', 'd', 'e'].map(prBars), [1, 2, 2, 3, 3]);
  applyPriorities([{ id: 'only', name: 'Only', w: 9 }]);
  assert.equal(prBars('only'), 2);
  applyPriorities(undefined);
});

test('removeLevel also drops the level from saved-view priority filters, and a filter left empty goes away', () => {
  const d = data();
  d.savedViews = [
    {
      id: 'v1',
      filters: [
        { f: 'priority', op: 'is', v: ['urgent', 'low'] },
        { f: 'status', op: 'is', v: ['todo'] },
      ],
    },
    { id: 'v2', filters: [{ f: 'priority', op: 'is', v: ['low'] }] },
    { id: 'v3' },
  ];
  removeLevel(d, 'low', 'none', 1);
  assert.deepEqual(d.savedViews[0].filters, [
    { f: 'priority', op: 'is', v: ['urgent'] },
    { f: 'status', op: 'is', v: ['todo'] },
  ]);
  assert.deepEqual(d.savedViews[1].filters, []);
  assert.equal(d.savedViews[2].filters, undefined);
});

test('normalizePriorities puts tasks with an unknown level on none and prunes stale filter ids', () => {
  const d = data();
  d.priorities = [
    { id: 'high', name: 'High', w: 3 },
    { id: 'none', name: 'No priority', w: 0 },
  ];
  d.tasks = [{ priority: 'high' }, { priority: 'gone' }, { priority: undefined }, {}];
  d.savedViews = [
    {
      filters: [
        { f: 'priority', op: 'is', v: ['high', 'gone'] },
        { f: 'priority', op: 'is', v: ['gone'] },
      ],
    },
  ];
  assert.equal(normalizePriorities(d), 3);
  assert.deepEqual(
    d.tasks.map(t => t.priority),
    ['high', 'none', 'none', 'none'],
  );
  assert.deepEqual(d.savedViews[0].filters, [{ f: 'priority', op: 'is', v: ['high'] }]);
  assert.equal(normalizePriorities(d), 0, 'idempotent');
});
