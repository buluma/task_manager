/* PR states for the app's PR icons, looked up on GitHub and cached. GR8R_GITHUB_TOKEN (a fine-grained token with
   read access to pull requests) lets it see private repos and raises GitHub's limit from 60 calls an hour; without
   it public PRs still work. The app asks through GET /api/prs, which only answers for PRs a "PR: <url>" comment links. */
import { prLinkIn, prLinkOf, prRef } from '../src/core/pr-links.js';

const OPEN_TTL = 10 * 60e3; // open and draft PRs move; merged and closed ones rarely do
const DONE_TTL = 24 * 3600e3;
const MISS_TTL = 10 * 60e3;
const PARALLEL = 8;

/* Every PR a comment of the workspace links, as "owner/repo#number" refs. */
export function linkedPrRefs(data) {
  return new Set(
    (data.comments || [])
      .map(c => prLinkIn(c.text))
      .filter(Boolean)
      .map(prRef),
  );
}

/* Tasks in Review and the PR their icon shows (the newest linked), as { id, key, ref }: the ones a merge moves to Done. */
export function reviewPrs(data) {
  const comments = data.comments || [];
  return data.tasks
    .filter(t => t.status === 'review' && !t.archived)
    .map(t => ({ t, pr: prLinkOf(comments.filter(c => c.task === t.id)) }))
    .filter(x => x.pr)
    .map(({ t, pr }) => ({ id: t.id, key: t.key, ref: prRef(pr) }));
}

/* The task keys of project `key` a PR names: in its title or branch, or in its body after a word like "implements",
   so a body that only mentions other tasks in passing does not link them. Upper case, each once. */
const BODY_WORDS = 'implements|implement|fixes|fix|fixed|closes|close|closed|resolves|resolve|resolved|part of|step of';
export function prKeysIn(pr, key) {
  const k = `(?<![A-Za-z0-9])${key}-(\\d+)(?![A-Za-z0-9])`;
  const named = [
    ...[pr.title, pr.branch].flatMap(s => [...(s || '').matchAll(new RegExp(k, 'gi'))]),
    ...(pr.body || '').matchAll(new RegExp(`\\b(?:${BODY_WORDS})\\s+${k}`, 'gi')),
  ];
  return [...new Set(named.map(m => `${key}-${+m[1]}`))];
}

/* What a PR's change of state since the last look means for its tasks: 'opened' when it is open now and was not (or
   merged without ever being seen open), 'closed' when it closed unmerged after being open or a draft, else null. */
export function prEvent(prev, state) {
  if (state === 'open' && prev !== 'open') return 'opened';
  if (state === 'merged' && prev !== 'merged' && prev !== 'open') return 'opened';
  if (state === 'closed' && (prev === 'open' || prev === 'draft')) return 'closed';
  return null;
}

const ghHeaders = token => ({
  accept: 'application/vnd.github+json',
  'user-agent': 'gr8r',
  'x-github-api-version': '2022-11-28',
  ...(token && { authorization: `Bearer ${token}` }),
});
const stateOfPull = pr => (pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open');

/* Returns `pulls(repo)`: the repo's 50 most recently updated PRs as { ref, url, title, body, branch, state }, or null
   when GitHub would not say. One call per repo, for the PR finder (syncProjectPrs in app.js). */
export function createPullLister({ token, fetch = globalThis.fetch } = {}) {
  return async function pulls(repo) {
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/pulls?state=all&sort=updated&direction=desc&per_page=50`, {
        headers: ghHeaders(token),
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) return null;
      return (await r.json()).map(pr => ({
        ref: `${repo}#${pr.number}`,
        url: pr.html_url,
        title: pr.title || '',
        body: pr.body || '',
        branch: pr.head?.ref || '',
        state: stateOfPull(pr),
      }));
    } catch {
      return null;
    }
  };
}

/* Returns `states(refs)`, resolving to { ref: 'open' | 'draft' | 'merged' | 'closed' | null }, null when GitHub
   would not say (not found, no access, rate limited or unreachable). */
export function createPrStates({ token, fetch = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(); // ref -> { state, until } or { pending }

  async function lookup(ref) {
    const [repo, number] = ref.split('#');
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, { headers: ghHeaders(token), signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      return stateOfPull(await r.json());
    } catch {
      return null;
    }
  }

  function stateOf(ref) {
    const hit = cache.get(ref);
    if (hit?.pending) return hit.pending;
    if (hit && hit.until > now()) return Promise.resolve(hit.state);
    const pending = lookup(ref).then(state => {
      const ttl = state === 'merged' || state === 'closed' ? DONE_TTL : state ? OPEN_TTL : MISS_TTL;
      cache.set(ref, { state, until: now() + ttl });
      return state;
    });
    cache.set(ref, { pending });
    return pending;
  }

  return async function states(refs) {
    const out = {};
    for (let i = 0; i < refs.length; i += PARALLEL) {
      const batch = refs.slice(i, i + PARALLEL);
      const got = await Promise.all(batch.map(stateOf));
      batch.forEach((ref, j) => (out[ref] = got[j]));
    }
    return out;
  };
}
