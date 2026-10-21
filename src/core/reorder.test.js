import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beforeOf, dropOrders, forceManual, isManual } from './reorder.js';

const orders = o => id => o[id];
const drawn = res => Object.keys(res).sort((a, b) => res[a] - res[b]);

test('forceManual switches any other sort, and Manual descending, to Manual ascending', () => {
  for (const sort of [
    { f: 'created', dir: 1 },
    { f: 'priority', dir: -1 },
    { f: 'manual', dir: -1 },
  ]) {
    const v = { sort };
    assert.equal(forceManual(v), true);
    assert.deepEqual(v.sort, { f: 'manual', dir: 1 });
  }
});

test('forceManual leaves Manual ascending alone', () => {
  const v = { sort: { f: 'manual', dir: 1 } };
  assert.equal(isManual(v), true);
  assert.equal(isManual({ sort: { f: 'manual', dir: -1 } }), false);
  assert.equal(forceManual(v), false);
  assert.deepEqual(v.sort, { f: 'manual', dir: 1 });
});

test('dropping a card where it already is changes nothing', () => {
  const o = orders({ a: 1, b: 2, c: 3 });
  assert.equal(dropOrders(['a', 'b', 'c'], 'b', 'c', o), null);
  assert.equal(dropOrders(['a', 'b', 'c'], 'c', null, o), null);
  assert.equal(dropOrders(['a', 'b', 'c'], 'a', 'b', o), null);
});

test('the column draws in the sequence the user saw, with the card where it was dropped', () => {
  // drawn newest first, so the order values run against the sequence on screen
  const o = orders({ c: 1, b: 2, a: 3 });
  const res = dropOrders(['a', 'b', 'c'], 'c', 'b', o);
  assert.deepEqual(drawn(res), ['a', 'c', 'b']);
  assert.deepEqual(Object.values(res).sort(), [1, 2, 3]);
});

test('a card from another column takes its place among the shown ones', () => {
  const res = dropOrders(['a', 'b'], 'x', 'b', orders({ a: 1, b: 2, x: 9 }));
  assert.deepEqual(drawn(res), ['a', 'x', 'b']);
  assert.deepEqual(drawn(dropOrders(['a', 'b'], 'x', null, orders({ a: 1, b: 2, x: 0 }))), ['a', 'b', 'x']);
});

test('order values the cards share, or lack, still give a strict sequence', () => {
  const res = dropOrders(['a', 'b', 'c', 'd'], 'a', null, orders({ a: 1, b: 1, c: undefined, d: 2 }));
  assert.deepEqual(drawn(res), ['b', 'c', 'd', 'a']);
  const vals = ['b', 'c', 'd', 'a'].map(x => res[x]);
  assert.ok(
    vals.every((x, i) => i === 0 || x > vals[i - 1]),
    `not increasing: ${vals}`,
  );
});

test('beforeOf names the row a dropped row lands above', () => {
  const shown = ['a', 'b', 'c', 'd'];
  assert.equal(beforeOf(shown, 'd', 'b', 'before'), 'b');
  assert.equal(beforeOf(shown, 'd', 'b', 'after'), 'c');
  // the dragged row itself is skipped, and after the last row is the bottom
  assert.equal(beforeOf(shown, 'c', 'b', 'after'), 'd');
  assert.equal(beforeOf(shown, 'a', 'd', 'after'), null);
});

test('a list row dropped across groups keeps the drawn sequence of the whole list', () => {
  // two groups drawn by priority, [a b] then [c d]; order values unrelated to that
  const o = orders({ a: 4, b: 1, c: 3, d: 2 });
  const shown = ['a', 'b', 'c', 'd'];
  const res = dropOrders(shown, 'a', beforeOf(shown, 'a', 'c', 'after'), o);
  assert.deepEqual(drawn(res), ['b', 'c', 'a', 'd']);
  // dropping just after the row above it leaves the list as it was
  assert.equal(dropOrders(shown, 'b', beforeOf(shown, 'b', 'a', 'after'), o), null);
});
