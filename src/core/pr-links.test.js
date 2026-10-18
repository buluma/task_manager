import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prLinkOf } from './pr-links.js';

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
