import { test } from 'node:test';
import assert from 'node:assert/strict';

/* store.js runs in the browser: stub just enough for it to load offline, with an empty workspace. */
Object.defineProperty(globalThis, 'document', { value: { querySelectorAll: () => [] }, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true });
globalThis.fetch = () => Promise.reject(new Error('offline'));
const { S, allTasks, canSee, save } = await import('./store.js');

test('canSee: a missing project is not visible instead of throwing', () => {
  assert.equal(canSee(undefined), false);
  assert.equal(canSee(null), false);
  assert.equal(canSee({ private: false, members: [] }), true);
  assert.equal(canSee({ private: true, members: [S.data.me] }), true);
  assert.equal(canSee({ private: true, members: ['someone-else'] }), false);
});

test('allTasks skips a task whose project is gone', () => {
  const tasks = S.data.tasks;
  S.data.tasks = [{ id: 'orphan', project: 'no-such-project', archived: false }];
  try {
    assert.deepEqual(allTasks(), []);
  } finally {
    S.data.tasks = tasks;
  }
});

test('save caches and stages the edit before the debounce timer runs', async () => {
  const writes = new Map();
  localStorage.setItem = (key, value) => writes.set(key, JSON.parse(value));
  const { SYNC_KEY } = await import('./sync.js');
  try {
    save();
    clearTimeout((await import('./store.js'))._saveT);
    assert.deepEqual(writes.get('gr8r.v2').data, S.data);
    assert.deepEqual(writes.get(SYNC_KEY).pending.data, S.data);
  } finally {
    localStorage.setItem = () => {};
  }
});
