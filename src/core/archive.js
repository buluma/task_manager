/* ---------- archive and permanent delete ----------
   Shared by the app (actions.js, actions/archive.js) and the server (server/tasks.js, server/projects.js), so
   archiving or deleting from either side leaves the same state. Callers find what they act on and apply their own
   guards first (the API only purges what is already archived); `ctx` is as in activity.js. */
import { logActivity } from './activity.js';

export function archiveTask(data, t, ctx) {
  if (t.archived) return;
  t.archived = true;
  t.archivedAt = ctx.now;
  logActivity(data, ctx, 'archived', t);
}

export function restoreTask(data, t, ctx) {
  if (!t.archived) return;
  t.archived = false;
  t.archivedAt = null;
  logActivity(data, ctx, 'restored', t);
}

/* The tasks, the dependency links pointing at them, and their comments. */
export function removeTasks(data, ids) {
  const gone = new Set(ids);
  data.tasks = data.tasks.filter(t => !gone.has(t.id));
  for (const t of data.tasks) if (t.deps) t.deps = t.deps.filter(d => !gone.has(d));
  if (data.comments) data.comments = data.comments.filter(c => !gone.has(c.task));
}

/* Archiving a project is not logged; its tasks stay as they are. */
export function archiveProject(p, now) {
  if (p.archived) return;
  p.archived = true;
  p.archivedAt = now;
}

export function restoreProject(p) {
  p.archived = false;
  p.archivedAt = null;
}

/* The project, every task in it (archived ones too) with their comments and dependency links, and its activity.
   Returns how many tasks went with it. */
export function removeProject(data, p) {
  const ids = data.tasks.filter(t => t.project === p.id).map(t => t.id);
  removeTasks(data, ids);
  data.projects = data.projects.filter(x => x !== p);
  if (data.projOrder) data.projOrder = data.projOrder.filter(id => id !== p.id);
  if (data.activity) data.activity = data.activity.filter(a => a.project !== p.id);
  return ids.length;
}
