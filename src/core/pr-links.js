/* ---------- GitHub PR links: `gr8r pr link` stores one as a "PR: <url>" comment ---------- */
/* Only a comment that starts "PR: <url>" links one: a PR mentioned in passing is not the task's PR, and a linked PR
   that merges can move the task to Done (server/app.js). */
const PR_LINK = /^PR: https:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)/;

/* The PR a comment's text links, or null. */
export function prLinkIn(text) {
  const m = PR_LINK.exec(text || '');
  return m ? { url: m[0].slice(4), repo: m[1], number: +m[2] } : null;
}

/* The PR linked by the newest comment that links one, or null. */
export function prLinkOf(comments) {
  for (const c of [...comments].sort((a, b) => b.at - a.at)) {
    const pr = prLinkIn(c.text);
    if (pr) return pr;
  }
  return null;
}

/* "owner/repo#number", how /api/prs names a PR. */
export const prRef = pr => `${pr.repo}#${pr.number}`;

/* The ids of tasks with at least one comment linking a PR. */
export function tasksWithPr(comments) {
  return new Set((comments || []).filter(c => prLinkIn(c.text)).map(c => c.task));
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
