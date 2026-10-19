/* ---------- activity log ----------
   The one way the shared changes in src/core/ record what happened. `ctx` says who acts and when, and makes ids in
   each side's own way: { by, now, newId(prefix) }. A logged change also counts as a change to the task. */
export function logActivity(data, ctx, verb, t, extra = '') {
  data.activity.unshift({ id: ctx.newId('a'), by: ctx.by, verb, task: t.id, project: t.project, at: ctx.now, extra });
  t.updated = ctx.now;
}

/* A project's own row (created, status changes): no task, and nothing to bump. */
export function logProjectActivity(data, ctx, verb, p, extra = '') {
  data.activity.unshift({ id: ctx.newId('a'), by: ctx.by, verb, task: null, project: p.id, at: ctx.now, extra });
}
