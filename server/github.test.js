import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPrStates, createPullLister, linkedPrRefs, prEvent, prKeysIn, reviewPrs } from './github.js';

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

test('linkedPrRefs finds the PR each "PR: <url>" comment links, and no other', () => {
  const data = {
    comments: [
      { text: 'PR: https://github.com/buluma/task_manager/pull/14' },
      { text: 'PR: https://github.com/o/r.js/pull/2' },
      { text: 'also https://github.com/o/r.js/pull/3' },
      { text: 'an issue https://github.com/o/r/issues/9' },
      { text: '' },
      {},
    ],
  };
  assert.deepEqual([...linkedPrRefs(data)].sort(), ['buluma/task_manager#14', 'o/r.js#2']);
});

test('reviewPrs lists tasks in Review with the PR their icon shows', () => {
  const data = {
    tasks: [
      { id: 't1', key: 'A-1', status: 'review' },
      { id: 't2', key: 'A-2', status: 'progress' },
      { id: 't3', key: 'A-3', status: 'review' },
      { id: 't4', key: 'A-4', status: 'review', archived: true },
      { id: 't5', key: 'A-5', status: 'review' },
    ],
    comments: [
      { task: 't1', at: 1, text: 'PR: https://github.com/o/r/pull/1' },
      { task: 't1', at: 2, text: 'PR: https://github.com/o/r/pull/7' },
      { task: 't2', at: 1, text: 'PR: https://github.com/o/r/pull/2' },
      { task: 't3', at: 1, text: 'no link here' },
      { task: 't3', at: 2, text: 'merged with https://github.com/o/r/pull/3' },
      { task: 't4', at: 1, text: 'PR: https://github.com/o/r/pull/4' },
      { task: 't5', at: 1, text: 'PR: https://github.com/o/r/pull/5' },
    ],
  };
  assert.deepEqual(reviewPrs(data), [
    { id: 't1', key: 'A-1', ref: 'o/r#7' },
    { id: 't5', key: 'A-5', ref: 'o/r#5' },
  ]);
  assert.deepEqual(reviewPrs({ tasks: [{ id: 't1', key: 'A-1', status: 'review' }] }), []);
});

test('prKeysIn finds the project key in the title, the branch, or after "implements"-like words in the body', () => {
  const pr = (title, branch, body = '') => ({ title, branch, body });
  assert.deepEqual(prKeysIn(pr('fix: strict CSP (RDD-29)', 'fix/rdd-29-strict-csp', 'RDD-29, follow-up to RDD-25 (#63).'), 'RDD'), ['RDD-29']);
  assert.deepEqual(prKeysIn(pr('Test drag and drop', 'drag-drop-tests', 'Implements CRN-68.\n\nThe bug behind CRN-63 and CRN-69 got through.'), 'CRN'), [
    'CRN-68',
  ]);
  assert.deepEqual(prKeysIn(pr('x', 'y', 'First step of CRN-6: a repo per project. Fixes crn-7, closes CRN-8; Part of CRN-9'), 'CRN'), [
    'CRN-6',
    'CRN-7',
    'CRN-8',
    'CRN-9',
  ]);
  assert.deepEqual(prKeysIn(pr('CRN-1 and CRN-1 again', 'crn-1-thing'), 'CRN'), ['CRN-1']);
  assert.deepEqual(prKeysIn(pr('UTF-8 and XCRN-4 and CRN-55x', 'feature/crn-12a'), 'CRN'), []);
  assert.deepEqual(prKeysIn(pr('RDD-3 is elsewhere', 'b'), 'CRN'), []);
  assert.deepEqual(prKeysIn({ title: 'CRN-2', branch: null, body: null }, 'CRN'), ['CRN-2']);
});

test('prEvent: opening (or merging unseen), and closing after being open, are the changes that matter', () => {
  assert.equal(prEvent(undefined, 'open'), 'opened');
  assert.equal(prEvent('draft', 'open'), 'opened');
  assert.equal(prEvent('closed', 'open'), 'opened');
  assert.equal(prEvent('open', 'open'), null);
  assert.equal(prEvent(undefined, 'merged'), 'opened', 'opened and merged between two looks');
  assert.equal(prEvent('draft', 'merged'), 'opened');
  assert.equal(prEvent('open', 'merged'), null, 'the merge itself is closeMergedReviews');
  assert.equal(prEvent('open', 'closed'), 'closed');
  assert.equal(prEvent('draft', 'closed'), 'closed');
  assert.equal(prEvent(undefined, 'closed'), null);
  assert.equal(prEvent(undefined, 'draft'), null);
  assert.equal(prEvent('merged', 'merged'), null);
});

test("createPullLister lists a repo's recently updated PRs with their state, and null when GitHub will not say", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, headers: init.headers });
    if (url.includes('/gone/')) return { ok: false, status: 404, json: async () => ({}) };
    const p = (number, state, extra = {}) => ({
      number,
      html_url: `https://github.com/o/r/pull/${number}`,
      title: `t${number}`,
      body: null,
      head: { ref: `b${number}` },
      state,
      draft: false,
      merged_at: null,
      ...extra,
    });
    return { ok: true, json: async () => [p(1, 'open'), p(2, 'open', { draft: true }), p(3, 'closed', { merged_at: 'x' }), p(4, 'closed')] };
  };
  const pulls = createPullLister({ fetch, token: 'tok' });
  assert.deepEqual(await pulls('o/r'), [
    { ref: 'o/r#1', url: 'https://github.com/o/r/pull/1', title: 't1', body: '', branch: 'b1', state: 'open' },
    { ref: 'o/r#2', url: 'https://github.com/o/r/pull/2', title: 't2', body: '', branch: 'b2', state: 'draft' },
    { ref: 'o/r#3', url: 'https://github.com/o/r/pull/3', title: 't3', body: '', branch: 'b3', state: 'merged' },
    { ref: 'o/r#4', url: 'https://github.com/o/r/pull/4', title: 't4', body: '', branch: 'b4', state: 'closed' },
  ]);
  assert.equal(calls[0].url, 'https://api.github.com/repos/o/r/pulls?state=all&sort=updated&direction=desc&per_page=50');
  assert.equal(calls[0].headers.authorization, 'Bearer tok');
  assert.equal(await pulls('o/gone'), null);
  assert.equal(
    await createPullLister({
      fetch: async () => {
        throw new Error('down');
      },
    })('o/r'),
    null,
  );
});

test('GitHub refusing or unreachable is reported, a missing PR is not, and an answer reports all clear', async () => {
  const reports = [];
  const report = p => reports.push(p);
  let reply;
  const fetch = async () => {
    if (reply instanceof Error) throw reply;
    return reply;
  };
  const res = (status, body = {}) => ({ ok: status < 300, status, json: async () => body });
  const pulls = createPullLister({ fetch, report });
  const states = createPrStates({ fetch, report });
  reply = res(401, { message: 'Bad credentials' });
  assert.equal(await pulls('o/r'), null);
  reply = res(403, { message: 'API rate limit exceeded' });
  assert.deepEqual(await states(['o/r#1']), { 'o/r#1': null });
  reply = new Error('getaddrinfo ENOTFOUND api.github.com');
  assert.equal(await pulls('o/r'), null);
  reply = res(404, { message: 'Not Found' });
  assert.equal(await pulls('o/gone'), null);
  reply = res(200, []);
  assert.deepEqual(await pulls('o/r'), []);
  assert.deepEqual(reports, [
    { status: 401, message: 'Bad credentials' },
    { status: 403, message: 'API rate limit exceeded' },
    { status: 0, message: 'getaddrinfo ENOTFOUND api.github.com' },
    null,
  ]);
});
