import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cycleEnd, cycleStart, cycleStats, pastCycles, rollCycles } from './cycles.js';

test('cycleStart finds the first day of the week for any week start', () => {
  // 2026-10-17 is a Saturday.
  assert.equal(cycleStart('2026-10-17', 1), '2026-10-12');
  assert.equal(cycleStart('2026-10-12', 1), '2026-10-12');
  assert.equal(cycleStart('2026-10-18', 1), '2026-10-12');
  assert.equal(cycleStart('2026-10-17', 0), '2026-10-11');
  assert.equal(cycleStart('2026-10-11', 0), '2026-10-11');
  assert.equal(cycleStart('2026-10-17', 6), '2026-10-17');
});

test('cycleStart and cycleEnd cross month, year and DST boundaries', () => {
  assert.equal(cycleStart('2026-01-02', 1), '2025-12-29');
  assert.equal(cycleEnd('2025-12-29'), '2026-01-04');
  assert.equal(cycleStart('2026-03-31', 1), '2026-03-30');
  assert.equal(cycleEnd('2026-03-30'), '2026-04-05');
  assert.equal(cycleEnd('2026-10-26'), '2026-11-01');
});

const mk = (id, cycle, status = 'todo', extra = {}) => ({ id, cycle, status, ...extra });

test('rollCycles carries unfinished tasks from past cycles into the current one', () => {
  const tasks = [mk('a', '2026-10-05'), mk('b', '2026-10-05', 'progress'), mk('c', '2026-10-12'), mk('d', null), mk('e')];
  assert.equal(rollCycles(tasks, '2026-10-12'), 2);
  assert.deepEqual(
    tasks.map(t => [t.id, t.cycle]),
    [
      ['a', '2026-10-12'],
      ['b', '2026-10-12'],
      ['c', '2026-10-12'],
      ['d', null],
      ['e', undefined],
    ],
  );
  assert.deepEqual(tasks[0].past, ['2026-10-05']);
  assert.equal(tasks[0].carried, 1);
});

test('rollCycles leaves done, archived and future-cycle tasks alone', () => {
  const tasks = [mk('a', '2026-10-05', 'done'), mk('b', '2026-10-05', 'todo', { archived: true }), mk('c', '2026-10-19')];
  assert.equal(rollCycles(tasks, '2026-10-12'), 0);
  assert.deepEqual(
    tasks.map(t => t.cycle),
    ['2026-10-05', '2026-10-05', '2026-10-19'],
  );
});

test('rollCycles is idempotent and accumulates history over several weeks', () => {
  const t = mk('a', '2026-09-28');
  rollCycles([t], '2026-10-05');
  assert.equal(rollCycles([t], '2026-10-05'), 0);
  rollCycles([t], '2026-10-12');
  assert.deepEqual(t.past, ['2026-09-28', '2026-10-05']);
  assert.equal(t.carried, 2);
});

test('cycleStats counts what was planned, finished and carried out of a cycle', () => {
  const tasks = [
    mk('a', '2026-10-05', 'done'),
    mk('b', '2026-10-12', 'todo', { past: ['2026-10-05'], carried: 1 }),
    mk('c', '2026-10-12', 'done', { past: ['2026-10-05'], carried: 1 }),
    mk('d', '2026-10-12'),
  ];
  assert.deepEqual(cycleStats(tasks, '2026-10-05'), { total: 3, done: 1, carried: 2 });
  assert.deepEqual(cycleStats(tasks, '2026-10-12'), { total: 3, done: 1, carried: 0 });
});

test('pastCycles lists earlier cycles newest first, excluding the current one', () => {
  const tasks = [mk('a', '2026-09-28', 'done'), mk('b', '2026-10-12', 'todo', { past: ['2026-10-05', '2026-09-28'] }), mk('c', '2026-10-12')];
  assert.deepEqual(pastCycles(tasks, '2026-10-12'), ['2026-10-05', '2026-09-28']);
});
