import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { LB, PR, PRIOS, applyPriorities, labelOf } from './constants.js';

afterEach(() => applyPriorities(undefined));

test('without a workspace scale the default levels apply', () => {
  assert.deepEqual(
    PRIOS.map(p => p.id),
    ['urgent', 'high', 'medium', 'low', 'none'],
  );
  assert.equal(PR.high.name, 'High');
});

test('a workspace scale replaces the levels in place, highest weight first', () => {
  const prios = PRIOS;
  const pr = PR;
  applyPriorities([
    { id: 'low', name: 'Someday', w: 1 },
    { id: 'blocker', name: 'Blocker', w: 5 },
    { id: 'none', name: 'No priority', w: 0 },
  ]);
  assert.equal(PRIOS, prios, 'same array, so importers see the change');
  assert.equal(PR, pr, 'same object, so importers see the change');
  assert.deepEqual(
    PRIOS.map(p => p.id),
    ['blocker', 'low', 'none'],
  );
  assert.equal(PR.low.name, 'Someday');
  assert.equal(PR.high, undefined);
});

test('the none level is always present', () => {
  applyPriorities([{ id: 'p1', name: 'Only', w: 3 }]);
  assert.deepEqual(PR.none, { id: 'none', name: 'No priority', w: 0 });
  assert.deepEqual(
    PRIOS.map(p => p.id),
    ['p1', 'none'],
  );
});

test('an empty scale falls back to the defaults', () => {
  applyPriorities([{ id: 'p1', name: 'Only', w: 3 }]);
  applyPriorities([]);
  assert.equal(PRIOS.length, 5);
});

test('labelOf finds a built-in label ignoring case, and gives any other label its own name in gray', () => {
  assert.deepEqual(labelOf('bug'), LB.bug);
  assert.deepEqual(labelOf('Bug'), LB.bug);
  assert.deepEqual(labelOf('Improvement'), { id: 'Improvement', name: 'Improvement', c: 'var(--gray)' });
});
