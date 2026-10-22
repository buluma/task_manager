import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACES, inWorkspace, isWorkspace, workspaceOf } from './workspaces.js';

test('there are two workspaces, Personal and Work', () => {
  assert.deepEqual(
    WORKSPACES.map(w => [w.id, w.name]),
    [
      ['personal', 'Personal'],
      ['work', 'Work'],
    ],
  );
  assert.equal(isWorkspace('work'), true);
  assert.equal(isWorkspace('all'), false);
  assert.equal(isWorkspace(undefined), false);
});

test('a project without a workspace, or with an unknown one, is Personal', () => {
  assert.equal(workspaceOf({ workspace: 'work' }), 'work');
  assert.equal(workspaceOf({}), 'personal');
  assert.equal(workspaceOf({ workspace: 'mars' }), 'personal');
  assert.equal(workspaceOf(undefined), 'personal');
});

test('"all" (or nothing chosen) shows every project; a workspace shows its own', () => {
  const work = { workspace: 'work' };
  const home = {};
  assert.deepEqual([inWorkspace(work, 'all'), inWorkspace(home, 'all'), inWorkspace(home, undefined)], [true, true, true]);
  assert.deepEqual([inWorkspace(work, 'work'), inWorkspace(home, 'work')], [true, false]);
  assert.deepEqual([inWorkspace(work, 'personal'), inWorkspace(home, 'personal')], [false, true]);
});
