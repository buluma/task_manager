/* ---------- GitHub PR links: `gr8r pr link` stores one as a "PR: <url>" comment ---------- */
const PR_URL = /https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

/* The PR named in the newest comment that has one, or null. */
export function prLinkOf(comments) {
  for (const c of [...comments].sort((a, b) => b.at - a.at)) {
    const m = PR_URL.exec(c.text || '');
    if (m) return { url: m[0], repo: m[1], number: +m[2] };
  }
  return null;
}

/* "owner/repo#number", how /api/prs names a PR. */
export const prRef = pr => `${pr.repo}#${pr.number}`;

/* Every PR a piece of text names, as refs. */
export function prRefsIn(text) {
  return [...(text || '').matchAll(new RegExp(PR_URL, 'g'))].map(m => `${m[1]}#${+m[2]}`);
}

/* How a PR's state is drawn: open, draft, merged, closed, or not known (no token, not found, not fetched yet). */
const LOOK = {
  open: ['git-pull-request', 'var(--green)', 'Open'],
  draft: ['git-pull-request-draft', 'var(--text-3)', 'Draft'],
  merged: ['git-merge', 'var(--violet)', 'Merged'],
  closed: ['git-pull-request-closed', 'var(--red)', 'Closed'],
};
export function prLook(state) {
  const [icon, color, name] = LOOK[state] || ['git-pull-request', '', ''];
  return { icon, color, name };
}
