/* ---------- workspace members ----------
   Shared by the app (actions.js: add member dialog, remove) and the server (server/people.js), so both add and
   remove people alike. Callers check their input and permissions first (who may be removed, which roles exist). */

/* "grace.hopper@navy.mil" → "Grace Hopper", the name a member gets until they set their own. */
export const nameFromEmail = email =>
  email
    .split('@')[0]
    .replace(/[._-]+/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());

/* Adds a member for each address not already in the workspace (each address once); returns the ones added. */
export function addMembers(data, emails, { role, team }, newId) {
  const added = [];
  for (const email of emails) {
    if (data.members.some(m => m.email === email)) continue;
    const m = { id: newId('m'), name: nameFromEmail(email), email, role, team, title: role, c: '#6B7280', status: 'active', last: null, tz: '—' };
    data.members.push(m);
    added.push(m);
  }
  return added;
}

/* The member goes; every task they were assigned is unassigned and they leave every project. */
export function removeMember(data, m) {
  data.members = data.members.filter(x => x !== m);
  for (const t of data.tasks) if (t.assignee === m.id) t.assignee = null;
  for (const p of data.projects) p.members = (p.members || []).filter(x => x !== m.id);
}
