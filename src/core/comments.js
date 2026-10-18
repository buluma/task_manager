/* ---------- comments ----------
   Shared by the app (actions.js) and the server (server/comments.js), so a comment posted from either side is stored
   and logged alike. Callers find the task and check the text first; `ctx` is as in activity.js. Reactions are
   app-only and stay in actions.js. */
import { logActivity } from './activity.js';

/* `at` backdates the comment, for importing history; such a comment is not logged as new activity. */
export function addComment(data, t, text, ctx, { at } = {}) {
  let id;
  do id = ctx.newId('c');
  while ((data.comments || []).some(c => c.id === id));
  const c = { id, task: t.id, by: ctx.by, at: at ?? ctx.now, text, re: {} };
  (data.comments ??= []).push(c);
  if (at === undefined) logActivity(data, ctx, 'commented on', t);
  return c;
}

export function removeComment(data, c) {
  data.comments = data.comments.filter(x => x !== c);
}
