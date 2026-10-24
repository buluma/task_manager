import { test } from 'node:test';
import assert from 'node:assert/strict';

/* store.js runs in the browser: stub just enough for it to load offline, with an empty workspace. */
Object.defineProperty(globalThis, 'document', { value: { querySelectorAll: () => [] }, configurable: true });
Object.defineProperty(globalThis, 'localStorage', { value: { getItem: () => null, setItem() {} }, configurable: true });
globalThis.fetch = () => Promise.reject(new Error('offline'));
const { S, allTasks, canSee, save, adoptState, DEVICE_PREFS, DEFAULT_PREFS } = await import('./store.js');

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

test('remote adoption updates all shared settings and views while keeping device UI state', async () => {
  const original = { data: S.data, prefs: S.prefs, views: S.views };
  const collapsed = S.ui.collapsed;
  const workspace = S.ui.workspace;
  const writes = new Map();
  localStorage.setItem = (key, value) => writes.set(key, JSON.parse(value));
  try {
    S.ui.collapsed = true;
    S.ui.workspace = 'work';
    S.prefs = { ...DEFAULT_PREFS, theme: 'light', accent: 'teal' };
    const remote = { data: structuredClone(S.data), prefs: { theme: 'dark', weekStart: 0 }, views: { tasks: { sort: 'due' } }, collapsed: false };
    adoptState(remote);
    assert.equal(S.prefs.theme, 'light');
    assert.equal(S.prefs.weekStart, 0);
    assert.equal(S.prefs.accent, 'teal');
    assert.deepEqual(S.views, remote.views);
    assert.equal(S.ui.collapsed, true);
    assert.equal(S.ui.workspace, 'work');
    S.data.ws.name = 'a later local edit';
    save();
    clearTimeout((await import('./store.js'))._saveT);
    const { SYNC_KEY } = await import('./sync.js');
    const pending = writes.get(SYNC_KEY).pending;
    assert.equal(pending.prefs.weekStart, 0);
    for (const key of DEVICE_PREFS) assert.equal(Object.hasOwn(pending.prefs, key), false);
    assert.equal(writes.get('gr8r.v2').prefs.theme, 'light');
    assert.deepEqual(pending.views, remote.views);
    assert.equal(Object.hasOwn(pending, 'collapsed'), false);
    assert.equal(writes.get('gr8r.v2').collapsed, true);
  } finally {
    S.ui.collapsed = collapsed;
    S.ui.workspace = workspace;
    adoptState(original);
    S.prefs = original.prefs;
    localStorage.setItem = () => {};
  }
});

test('workspace feeds and archives isolate Personal, Work, private and orphan records', async () => {
  const { activityHere, notifsHere, archivedTasksHere, archivedProjectsHere, eventsHere } = await import('./store.js');
  const original = S.data;
  const workspace = S.ui.workspace;
  try {
    S.data = {
      ...original,
      projects: [
        { id: 'personal', members: [] },
        { id: 'work', workspace: 'work', members: [] },
        { id: 'private', private: true, members: [] },
        { id: 'archived', archived: true, members: [] },
      ],
      tasks: [
        { id: 'tp', project: 'personal', archived: true },
        { id: 'tw', project: 'work', archived: true },
        { id: 'hidden', project: 'private', archived: true },
        { id: 'orphan', project: 'missing', archived: true },
      ],
      activity: [
        { id: 'ap', project: 'personal' },
        { id: 'aw', project: 'work' },
        { id: 'private', project: 'private' },
        { id: 'orphan', project: 'missing' },
        { id: 'fallback', task: 'tw' },
        { id: 'global' },
      ],
      notifs: [
        { id: 'np', task: 'tp' },
        { id: 'nw', task: 'tw' },
        { id: 'hidden', task: 'hidden' },
        { id: 'orphan', task: 'orphan' },
        { id: 'deleted', task: 'deleted' },
        { id: 'global' },
      ],
    };
    S.data.events = S.data.activity.filter(a => !a.task).map(a => ({ ...a }));
    const ids = rows => rows.map(r => r.id);
    S.ui.workspace = 'personal';
    assert.deepEqual(ids(activityHere()), ['ap', 'global']);
    assert.deepEqual(ids(eventsHere()), ['ap', 'global']);
    assert.deepEqual(ids(notifsHere()), ['np', 'global']);
    assert.deepEqual(ids(archivedTasksHere()), ['tp']);
    assert.deepEqual(ids(archivedProjectsHere()), ['archived']);
    S.ui.workspace = 'work';
    assert.deepEqual(ids(activityHere()), ['aw', 'fallback', 'global']);
    assert.deepEqual(ids(eventsHere()), ['aw', 'global']);
    assert.deepEqual(ids(notifsHere()), ['nw', 'global']);
    assert.deepEqual(ids(archivedTasksHere()), ['tw']);
    assert.deepEqual(ids(archivedProjectsHere()), []);
    S.ui.workspace = 'all';
    assert.deepEqual(ids(activityHere()), ['ap', 'aw', 'fallback', 'global']);
    assert.deepEqual(ids(notifsHere()), ['np', 'nw', 'global']);
  } finally {
    S.data = original;
    S.ui.workspace = workspace;
  }
});

test('visibleProjects lists favorited projects first, each group in sidebar order', async () => {
  const { visibleProjects } = await import('./store.js');
  const original = S.data;
  try {
    S.data = {
      ...original,
      projects: ['a', 'b', 'c', 'd'].map(id => ({ id, fav: id === 'b' || id === 'd', members: [] })),
      projOrder: ['a', 'b', 'c', 'd'],
    };
    assert.deepEqual(
      visibleProjects().map(p => p.id),
      ['b', 'd', 'a', 'c'],
    );
  } finally {
    S.data = original;
  }
});
