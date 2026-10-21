/* Comments on tasks. Posting, editing and deleting go through src/core/comments.js, as the app's do. Text is plain text, as
   in the app, which escapes and formats it when it renders. */
import { addComment as postComment, editComment as reword, removeComment } from '../src/core/comments.js';
import { ApiError, bad, changeCtx, findTask, notifyOwner } from './tasks.js';

const MAX_TEXT = 20000;

export function listComments(data, key) {
  const t = findTask(data, key);
  return (data.comments || []).filter(c => c.task === t.id).sort((a, b) => a.at - b.at);
}

/* `at` (an ISO date or date-time) backdates the comment, for importing history; such a comment is not logged as
   new activity. Without it the comment is stamped now and logged like one posted in the app. */
/* The body's `text`, trimmed, after checking the body has only `allowed` fields. */
function textOf(input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  if (typeof input.text !== 'string' || !input.text.trim()) throw bad('text must be a non-empty string');
  const text = input.text.trim();
  if (text.length > MAX_TEXT) throw bad(`text must be at most ${MAX_TEXT} characters`);
  return text;
}

export function addComment(data, key, input, now) {
  const text = textOf(input, ['text', 'at']);
  let at;
  if (input.at !== undefined) {
    at = typeof input.at === 'string' ? Date.parse(input.at) : NaN;
    if (Number.isNaN(at)) throw bad('at must be an ISO date or date-time');
  }
  const t = findTask(data, key);
  const c = postComment(data, t, text, changeCtx(data, now), { at });
  if (at === undefined) notifyOwner(data, t, 'comment', 'commented on', text.length > 140 ? text.slice(0, 139) + '…' : text, now);
  return c;
}

function findComment(data, key, id) {
  const t = findTask(data, key);
  const c = (data.comments || []).find(x => x.id === id && x.task === t.id);
  if (!c) throw new ApiError(404, `no comment ${id} on ${t.key}`);
  return c;
}

/* Changes only the text, so a fixed comment keeps its place and date; nothing is logged or raised. */
export function editComment(data, key, id, input) {
  const text = textOf(input, ['text']);
  const c = findComment(data, key, id);
  reword(c, text);
  return c;
}

export function deleteComment(data, key, id) {
  const c = findComment(data, key, id);
  removeComment(data, c);
  return c;
}
