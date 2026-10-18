/* Comments on tasks, mirroring postComment / delComment in the app. Text is plain text, as in the app, which
   escapes and formats it when it renders. */
import { ApiError, actorOf, bad, findTask, rand } from './tasks.js';

const MAX_TEXT = 20000;

export function listComments(data, key) {
  const t = findTask(data, key);
  return (data.comments || []).filter(c => c.task === t.id).sort((a, b) => a.at - b.at);
}

/* `at` (an ISO date or date-time) backdates the comment, for importing history; such a comment is not logged as
   new activity. Without it the comment is stamped now and logged like one posted in the app. */
export function addComment(data, key, input, now) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!['text', 'at'].includes(k)) throw bad(`unknown field: ${k}`);
  if (typeof input.text !== 'string' || !input.text.trim()) throw bad('text must be a non-empty string');
  const text = input.text.trim();
  if (text.length > MAX_TEXT) throw bad(`text must be at most ${MAX_TEXT} characters`);
  let at = now;
  if (input.at !== undefined) {
    at = typeof input.at === 'string' ? Date.parse(input.at) : NaN;
    if (Number.isNaN(at)) throw bad('at must be an ISO date or date-time');
  }
  const t = findTask(data, key);
  let id;
  do id = 'c' + rand();
  while ((data.comments || []).some(c => c.id === id));
  const c = { id, task: t.id, by: actorOf(data), at, text, re: {} };
  (data.comments ??= []).push(c);
  if (input.at === undefined) {
    data.activity.unshift({ id: 'a' + rand(), by: actorOf(data), verb: 'commented on', task: t.id, project: t.project, at: now, extra: '' });
    t.updated = now;
  }
  return c;
}

export function deleteComment(data, key, id) {
  const t = findTask(data, key);
  const c = (data.comments || []).find(x => x.id === id && x.task === t.id);
  if (!c) throw new ApiError(404, `no comment ${id} on ${t.key}`);
  data.comments = data.comments.filter(x => x !== c);
  return c;
}
