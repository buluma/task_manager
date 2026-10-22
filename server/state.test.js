import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeState, STATE_VERSION } from './state.js';

const legacy = () => ({
  data: {
    me: 'm1',
    members: [{ id: 'm1', name: 'Me' }],
    projects: [{ id: 'p1', key: 'GR', name: 'Tasks' }],
    tasks: [{ id: 't1', key: 'GR-1', project: 'p1', title: 'One', status: 'todo' }],
  },
});

test('unversioned workspaces migrate without mutating their input and migration is idempotent', () => {
  const original = legacy();
  const state = normalizeState(original);
  assert.equal(state.schemaVersion, STATE_VERSION);
  assert.equal(original.schemaVersion, undefined);
  assert.deepEqual(state.data.tasks[0].subtasks, []);
  assert.deepEqual(state.data.projOrder, ['p1']);
  assert.deepEqual(state.data.comments, []);
  assert.deepEqual(state.views, {});
  assert.deepEqual(normalizeState(state), state);
});

test('invalid shapes, duplicate identities and broken task references are rejected', () => {
  const cases = [
    [
      s => {
        s.data.tasks = 'bad';
      },
      /data.tasks/,
    ],
    [
      s => {
        delete s.data.projects;
      },
      /data.projects/,
    ],
    [
      s => {
        s.data.members = {};
      },
      /data.members/,
    ],
    [
      s => {
        s.data.me = 'missing';
      },
      /data.me/,
    ],
    [
      s => {
        s.data.tasks.push(structuredClone(s.data.tasks[0]));
      },
      /duplicate id/,
    ],
    [
      s => {
        s.data.projects.push({ ...s.data.projects[0], id: 'p2' });
      },
      /duplicate project key/,
    ],
    [
      s => {
        s.data.tasks.push({ ...s.data.tasks[0], id: 't2' });
      },
      /duplicate task key/,
    ],
    [
      s => {
        s.data.tasks[0].project = 'missing';
      },
      /task.project/,
    ],
    [
      s => {
        s.data.tasks[0].assignee = 'missing';
      },
      /task.assignee/,
    ],
    [
      s => {
        s.data.tasks[0].status = 'wat';
      },
      /task.status/,
    ],
    [
      s => {
        s.data.tasks[0].labels = 'bad';
      },
      /task.labels/,
    ],
    [
      s => {
        s.data.tasks[0].deps = ['missing'];
      },
      /task.deps/,
    ],
    [
      s => {
        s.data.tasks[0].due = '2026-02-30';
      },
      /task.due/,
    ],
    [
      s => {
        s.data.tasks[0].subtasks = [{ id: 's1', title: 'Sub', done: 'yes' }];
      },
      /subtask.done/,
    ],
    [
      s => {
        s.data.comments = [{ id: 'c1', task: 'missing', text: 'x' }];
      },
      /comment.task/,
    ],
    [
      s => {
        s.prefs = { name: {} };
      },
      /prefs.name/,
    ],
    [
      s => {
        s.views = { tasks: { filters: [null] } };
      },
      /filters/,
    ],
    [
      s => {
        s.schemaVersion = STATE_VERSION + 1;
      },
      /unsupported workspace version/,
    ],
  ];
  for (const [change, error] of cases) {
    const state = legacy();
    change(state);
    assert.throws(() => normalizeState(state), error);
  }
});

test('current-version workspaces cannot silently lose required collections', () => {
  const state = normalizeState(legacy());
  delete state.data.comments;
  assert.throws(() => normalizeState(state), /data.comments/);
});

test('historical activity and Inbox references can outlive their task or author', () => {
  const state = legacy();
  state.data.activity = [{ id: 'a1', task: 'purged', by: 'removed', verb: 'completed' }];
  state.data.notifs = [{ id: 'n1', task: 'purged', by: 'removed', text: 'completed' }];
  assert.doesNotThrow(() => normalizeState(state));
});
