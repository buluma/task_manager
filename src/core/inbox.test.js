import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inboxCats } from './inbox.js';

const me = { id: 'm1', name: 'Me' };
const bot = { id: 'a1', name: 'Claude', agent: true };
const ann = { id: 'm2', name: 'Ann' };
const ids = cats => cats.map(c => c[0]);

test('a solo user with agents sees only the tabs that can fire', () => {
  assert.deepEqual(ids(inboxCats([me, bot], [])), ['all', 'needs', 'comment', 'update']);
});

test('a second human brings Mentions and Assignments back', () => {
  assert.deepEqual(ids(inboxCats([me, ann], [])), ['all', 'needs', 'mention', 'assign', 'comment', 'update']);
});

test('existing mention or assignment items keep their tab even when solo', () => {
  assert.deepEqual(ids(inboxCats([me], [{ type: 'mention' }])), ['all', 'needs', 'mention', 'comment', 'update']);
  assert.deepEqual(ids(inboxCats([me], [{ type: 'assign' }])), ['all', 'needs', 'assign', 'comment', 'update']);
});

test('tabs carry their labels', () => {
  assert.deepEqual(inboxCats([me], [])[1], ['needs', 'Needs you']);
});
