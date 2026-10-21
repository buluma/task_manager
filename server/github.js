/* PR states for the app's PR icons, looked up on GitHub and cached. GR8R_GITHUB_TOKEN (a fine-grained token with
   read access to pull requests) lets it see private repos and raises GitHub's limit from 60 calls an hour; without
   it public PRs still work. The app asks through GET /api/prs, which only answers for PRs linked in a comment. */
import { prRefsIn } from '../src/core/pr-links.js';

const OPEN_TTL = 10 * 60e3; // open and draft PRs move; merged and closed ones rarely do
const DONE_TTL = 24 * 3600e3;
const MISS_TTL = 10 * 60e3;
const PARALLEL = 8;

/* Every PR named in any comment of the workspace, as "owner/repo#number" refs. */
export function linkedPrRefs(data) {
  return new Set((data.comments || []).flatMap(c => prRefsIn(c.text)));
}

/* Returns `states(refs)`, resolving to { ref: 'open' | 'draft' | 'merged' | 'closed' | null }, null when GitHub
   would not say (not found, no access, rate limited or unreachable). */
export function createPrStates({ token, fetch = globalThis.fetch, now = Date.now } = {}) {
  const cache = new Map(); // ref -> { state, until } or { pending }

  async function lookup(ref) {
    const [repo, number] = ref.split('#');
    const headers = { accept: 'application/vnd.github+json', 'user-agent': 'gr8r', 'x-github-api-version': '2022-11-28' };
    if (token) headers.authorization = `Bearer ${token}`;
    try {
      const r = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, { headers, signal: AbortSignal.timeout(8000) });
      if (!r.ok) return null;
      const pr = await r.json();
      return pr.merged_at ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
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
