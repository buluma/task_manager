/* ---------- links to a task or project ----------
   Copy link hands out <page>#task/GR-12 or <page>#project/gr; main.js opens the app on what the link names. Keys
   match ignoring case, as on the API. */

/* `page` is the app's address without its hash (origin + pathname). */
export const linkTo = (page, kind, key) => `${page}#${kind}/${encodeURIComponent(kind === 'project' ? key.toLowerCase() : key)}`;

/* { task: id } or { project: id } for a link to something that exists, else null. Archived projects have no page to
   open; visibility is the caller's to check. */
export function resolveLink(data, hash) {
  const m = /^#(task|project)\/([^/]+)$/.exec(hash || '');
  if (!m) return null;
  const key = decodeURIComponent(m[2]).toLowerCase();
  if (m[1] === 'task') {
    const t = data.tasks.find(x => x.key.toLowerCase() === key);
    return t ? { task: t.id } : null;
  }
  const p = data.projects.find(x => !x.archived && x.key.toLowerCase() === key);
  return p ? { project: p.id } : null;
}
