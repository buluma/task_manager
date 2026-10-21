import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prLinkIn, prLinkOf, prLook, prRef, tasksWithPr } from './pr-links.js';

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

test('only a comment starting "PR: <url>", as gr8r pr link writes it, links a PR', () => {
  assert.equal(prLinkOf([c('see https://github.com/a/b/pull/5, thanks', 1)]), null);
  assert.equal(prLinkOf([c('PR opened: https://github.com/a/b/pull/5', 1)]), null);
  assert.equal(prLinkOf([c('**OAuth, PR #6.** notes https://github.com/a/b/pull/6', 1)]), null);
  assert.equal(prLinkOf([c(' PR: https://github.com/a/b/pull/5', 1)]), null);
  const linked = c('PR: https://github.com/a/b/pull/5', 1);
  assert.equal(prLinkOf([linked, c('also see https://github.com/a/b/pull/8', 2)]).number, 5);
});

test('a link followed by more text is trimmed to the PR itself', () => {
  assert.equal(prLinkOf([c('PR: https://github.com/a/b/pull/5/files', 1)]).url, 'https://github.com/a/b/pull/5');
  assert.equal(prLinkOf([c('PR: https://github.com/a/b/pull/5 (squashed)', 1)]).url, 'https://github.com/a/b/pull/5');
});

test('lookalike hosts are not treated as GitHub', () => {
  assert.equal(prLinkOf([c('PR: https://github.com.evil.example/a/b/pull/5', 1)]), null);
  assert.equal(prLinkOf([c('PR: https://notgithub.com/a/b/pull/5', 1)]), null);
});

test('prRef names a PR as owner/repo#number', () => {
  assert.equal(prRef(prLinkOf([c('PR: https://github.com/a/b.js/pull/7', 1)])), 'a/b.js#7');
});

test('prLinkIn reads the PR a comment text links, or null', () => {
  assert.deepEqual(prLinkIn('PR: https://github.com/a/b/pull/01'), { url: 'https://github.com/a/b/pull/01', repo: 'a/b', number: 1 });
  assert.equal(prLinkIn('https://github.com/a/b/pull/1'), null);
  assert.equal(prLinkIn('PR: https://github.com/a/b/issues/1'), null);
  assert.equal(prLinkIn(undefined), null);
});

test('prLook gives each state its own icon and name, and a plain icon when the state is unknown', () => {
  assert.deepEqual(
    ['open', 'draft', 'merged', 'closed'].map(s => prLook(s).icon),
    ['git-pull-request', 'git-pull-request-draft', 'git-merge', 'git-pull-request-closed'],
  );
  assert.equal(prLook('merged').name, 'Merged');
  assert.deepEqual(prLook(null), { icon: 'git-pull-request', color: '', name: '' });
});

test('tasksWithPr names the tasks that have a comment linking a PR', () => {
  const comments = [
    { task: 't1', text: 'PR: https://github.com/a/b/pull/1' },
    { task: 't2', text: 'see https://github.com/a/b/issues/2' },
    { task: 't3', text: 'looks good' },
    { task: 't3', text: 'PR: https://github.com/a/b/pull/4' },
    { task: 't4', text: 'merged in https://github.com/a/b/pull/5' },
    { task: 't5' },
  ];
  assert.deepEqual([...tasksWithPr(comments)].sort(), ['t1', 't3']);
  assert.deepEqual([...tasksWithPr(undefined)], []);
});
