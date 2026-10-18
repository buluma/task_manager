/* ---------- subtasks ----------
   Shared by the app (actions.js, actions/subtasks.js) and the server (server/relations.js), so a subtask change
   records the same thing from either side. Callers find the task and check their input first. `ctx` says who
   acts and when, and makes ids in each side's own way: { by, now, newId(prefix) }. */

const log = (data, ctx, verb, t, extra) => {
  data.activity.unshift({ id: ctx.newId('a'), by: ctx.by, verb, task: t.id, project: t.project, at: ctx.now, extra });
  t.updated = ctx.now;
};

export function addSub(data, t, title, ctx) {
  let id;
  do id = ctx.newId('s');
  while ((t.subtasks || []).some(s => s.id === id));
  const s = { id, title, done: false };
  (t.subtasks ??= []).push(s);
  log(data, ctx, 'added subtask to', t, `“${title}”`);
  return s;
}

export function setSubDone(data, t, s, done, ctx) {
  if (s.done === done) return;
  s.done = done;
  log(data, ctx, done ? 'completed subtask on' : 'reopened subtask on', t, `“${s.title}”`);
}

/* Renaming and removing a subtask are not logged, but they do change the task. */
export function renameSub(t, s, title, now) {
  s.title = title;
  t.updated = now;
}

export function removeSub(t, s, now) {
  t.subtasks = t.subtasks.filter(x => x !== s);
  t.updated = now;
}
