import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LABELS, LB, applyLabels } from './constants.js';
import { LabelError, addLabel, adoptLabels, labelList, patchLabel, removeLabel } from './labels.js';

afterEach(() => applyLabels(undefined));
const NOW = 1000;
const state = () => ({
  tasks: [
    { id: 't1', labels: ['Bug', 'Improvement'], updated: 1 },
    { id: 't2', labels: ['improvement'], updated: 1 },
    { id: 't3', labels: [], updated: 1 },
  ],
  savedViews: [
    {
      id: 'v1',
      filters: [
        { f: 'labels', v: ['Improvement'] },
        { f: 'status', v: ['todo'] },
      ],
    },
  ],
});

test('labelList is the built-in labels until edited, plus every other label in use, gray, once each', () => {
  const list = labelList(state());
  assert.deepEqual(
    list.slice(0, DEFAULT_LABELS.length).map(l => l.id),
    DEFAULT_LABELS.map(l => l.id),
  );
  assert.deepEqual(list.slice(DEFAULT_LABELS.length), [{ id: 'Improvement', name: 'Improvement', color: 'gray' }]);
});

test('addLabel adds a label named as typed, in a known colour, and refuses a name already used', () => {
  const d = state();
  assert.deepEqual(addLabel(d, { name: '  Chore ', color: 'teal' }), { id: 'Chore', name: 'Chore', color: 'teal' });
  assert.equal(d.labels.at(-1).id, 'Chore');
  assert.ok(d.labels.some(l => l.id === 'Improvement')); // editing makes the labels in use the workspace's own
  for (const input of [{ name: 'chore' }, { name: 'bug' }, { name: 'Design' }, { name: '' }, { name: 'X', color: 'plaid' }, { name: 'X', extra: 1 }])
    assert.throws(() => addLabel(d, input), LabelError, JSON.stringify(input));
});

test('patchLabel renames or recolours a label by id, ignoring case; the id that tasks carry stays', () => {
  const d = state();
  assert.deepEqual(patchLabel(d, 'improvement', { name: 'Enhancement', color: 'green' }), { id: 'Improvement', name: 'Enhancement', color: 'green' });
  assert.deepEqual(d.tasks[0].labels, ['Bug', 'Improvement']);
  assert.throws(() => patchLabel(d, 'bug', { name: 'enhancement' }), LabelError);
  assert.throws(
    () => patchLabel(d, 'nope', { name: 'X' }),
    err => err.status === 404,
  );
  assert.throws(() => patchLabel(d, 'bug', {}), LabelError);
});

test('removeLabel takes the label off the list, off every task in any spelling, and out of saved filters', () => {
  const d = state();
  assert.equal(removeLabel(d, 'Improvement', NOW), 2);
  assert.ok(!d.labels.some(l => l.id === 'Improvement'));
  assert.deepEqual(
    d.tasks.map(t => [t.labels, t.updated]),
    [
      [['Bug'], NOW],
      [[], NOW],
      [[], 1],
    ],
  );
  assert.deepEqual(d.savedViews[0].filters, [{ f: 'status', v: ['todo'] }]);
});

test('adoptLabels makes the workspace list the live one the app draws from', () => {
  const d = state();
  patchLabel(d, 'bug', { color: 'orange' });
  adoptLabels(d);
  assert.equal(LB.bug.c, 'var(--orange)');
  applyLabels(undefined);
  assert.equal(LB.bug.c, 'var(--red)');
});
