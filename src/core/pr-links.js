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
