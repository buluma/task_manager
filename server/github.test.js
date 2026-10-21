import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrStates, linkedPrRefs } from './github.js';

/* A fake GitHub: `prs` maps "owner/repo#n" to the pull request JSON, or to a status code for an error. */
function fakeGitHub(prs) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    const m = /repos\/([^/]+\/[^/]+)\/pulls\/(\d+)$/.exec(url);
    const pr = prs[`${m[1]}#${m[2]}`];
    if (typeof pr === 'number') return { ok: false, status: pr, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => pr };
  };
  return { fetch, calls };
}

test('maps GitHub pull requests to open, draft, merged and closed', async () => {
  const gh = fakeGitHub({
    'o/r#1': { state: 'open', draft: false, merged_at: null },
    'o/r#2': { state: 'open', draft: true, merged_at: null },
    'o/r#3': { state: 'closed', draft: false, merged_at: '2026-10-01T00:00:00Z' },
    'o/r#4': { state: 'closed', draft: false, merged_at: null },
  });
  const states = createPrStates({ fetch: gh.fetch });
  assert.deepEqual(await states(['o/r#1', 'o/r#2', 'o/r#3', 'o/r#4']), { 'o/r#1': 'open', 'o/r#2': 'draft', 'o/r#3': 'merged', 'o/r#4': 'closed' });
  assert.equal(gh.calls[0].url, 'https://api.github.com/repos/o/r/pulls/1');
});

test('sends the token when there is one, and none otherwise', async () => {
  const pr = { 'o/r#1': { state: 'open' } };
  const withToken = fakeGitHub(pr);
  await createPrStates({ fetch: withToken.fetch, token: 'tok' })(['o/r#1']);
  assert.equal(withToken.calls[0].headers.authorization, 'Bearer tok');
  const without = fakeGitHub(pr);
  await createPrStates({ fetch: without.fetch })(['o/r#1']);
  assert.equal(without.calls[0].headers.authorization, undefined);
});

test('a PR GitHub will not show, or a failed call, comes back as null', async () => {
  const gh = fakeGitHub({ 'o/r#1': 404 });
  const failing = async () => {
    throw new Error('network down');
  };
  assert.deepEqual(await createPrStates({ fetch: gh.fetch })(['o/r#1']), { 'o/r#1': null });
  assert.deepEqual(await createPrStates({ fetch: failing })(['o/r#2']), { 'o/r#2': null });
});

test('caches open PRs for minutes and finished ones for a day', async () => {
  let t = 0;
  const gh = fakeGitHub({ 'o/r#1': { state: 'open' }, 'o/r#2': { state: 'closed', merged_at: 'x' } });
  const states = createPrStates({ fetch: gh.fetch, now: () => t });
  await states(['o/r#1', 'o/r#2']);
  t = 5 * 60e3;
  await states(['o/r#1', 'o/r#2']);
  assert.equal(gh.calls.length, 2);
  t = 11 * 60e3;
  await states(['o/r#1', 'o/r#2']);
  assert.deepEqual(
    gh.calls.map(c => c.url.split('/').pop()),
    ['1', '2', '1'],
  );
  t = 25 * 3600e3;
  await states(['o/r#2']);
  assert.equal(gh.calls.length, 4);
});

test('asks GitHub once for a PR requested twice at the same time', async () => {
  const gh = fakeGitHub({ 'o/r#1': { state: 'open' } });
  const states = createPrStates({ fetch: gh.fetch });
  await Promise.all([states(['o/r#1']), states(['o/r#1'])]);
  assert.equal(gh.calls.length, 1);
});

test('linkedPrRefs finds every PR named in any comment', () => {
  const data = {
    comments: [
      { text: 'PR: https://github.com/buluma/task_manager/pull/14' },
      { text: 'also https://github.com/o/r.js/pull/2 and https://github.com/o/r.js/pull/3' },
      { text: 'an issue https://github.com/o/r/issues/9' },
      { text: '' },
      {},
    ],
  };
  assert.deepEqual([...linkedPrRefs(data)].sort(), ['buluma/task_manager#14', 'o/r.js#2', 'o/r.js#3']);
});
