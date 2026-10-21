import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prLinkOf, prLook, prRef, prRefsIn } from './pr-links.js';

const c = (text, at) => ({ text, at });

test('no comments, or none with a PR url, gives no link', () => {
  assert.equal(prLinkOf([]), null);
  assert.equal(prLinkOf([c('looks good', 1), c('see https://github.com/buluma/task_manager/issues/3', 2)]), null);
});

test('finds a PR url in a comment and names the repo and number', () => {
  assert.deepEqual(prLinkOf([c('PR: https://github.com/buluma/task_manager/pull/14', 1)]), {
    url: 'https://github.com/buluma/task_manager/pull/14',
    repo: 'buluma/task_manager',
    number: 14,
  });
});

test('the newest comment wins when several PRs are linked', () => {
  const link = prLinkOf([c('PR: https://github.com/a/b/pull/9', 20), c('PR: https://github.com/a/b/pull/2', 10)]);
  assert.equal(link.number, 9);
});

test('a url followed by punctuation or more text is trimmed to the PR itself', () => {
  assert.equal(prLinkOf([c('merged (https://github.com/a/b/pull/5/files).', 1)]).url, 'https://github.com/a/b/pull/5');
  assert.equal(prLinkOf([c('see https://github.com/a/b/pull/5, thanks', 1)]).url, 'https://github.com/a/b/pull/5');
});

test('lookalike hosts are not treated as GitHub', () => {
  assert.equal(prLinkOf([c('https://github.com.evil.example/a/b/pull/5', 1)]), null);
  assert.equal(prLinkOf([c('https://notgithub.com/a/b/pull/5', 1)]), null);
});

test('prRef names a PR as owner/repo#number', () => {
  assert.equal(prRef(prLinkOf([c('PR: https://github.com/a/b.js/pull/7', 1)])), 'a/b.js#7');
});

test('prRefsIn finds every PR in a text, and nothing in no text', () => {
  assert.deepEqual(prRefsIn('https://github.com/a/b/pull/1 then (https://github.com/c/d/pull/02/files)'), ['a/b#1', 'c/d#2']);
  assert.deepEqual(prRefsIn('https://github.com/a/b/issues/1'), []);
  assert.deepEqual(prRefsIn(undefined), []);
});

test('prLook gives each state its own icon and name, and a plain icon when the state is unknown', () => {
  assert.deepEqual(
    ['open', 'draft', 'merged', 'closed'].map(s => prLook(s).icon),
    ['git-pull-request', 'git-pull-request-draft', 'git-merge', 'git-pull-request-closed'],
  );
  assert.equal(prLook('merged').name, 'Merged');
  assert.deepEqual(prLook(null), { icon: 'git-pull-request', color: '', name: '' });
});
