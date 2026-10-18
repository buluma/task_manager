/* The owner's Inbox, over the API: agents raise items, anyone can list them and mark them read. The same
   `notifs` list the app's Inbox page shows; writes by agents also raise some automatically (see notifyOwner). */
import { ApiError, actorOf, bad, findTask, rand } from './tasks.js';

/* `needs` is an agent asking for the owner: a question, an approval or a review. */
const TYPES = ['needs', 'mention', 'assign', 'comment', 'update'];
const MAX_TEXT = 500;
const MAX_SNIPPET = 500;

const strictBody = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  return input;
};

/* Newest first. `key` (the task's key) and `from` (the sender's name) are added for readers outside the app. */
export function listNotifications(data, params) {
  const unread = params.get('unread');
  return (data.notifs || [])
    .filter(n => !unread || !n.read)
    .sort((a, b) => b.at - a.at)
    .map(n => ({ ...n, key: data.tasks.find(t => t.id === n.task)?.key ?? null, from: data.members.find(m => m.id === n.by)?.name ?? null }));
}

/* `task` (a key) is optional: without it the item is a general message. */
export function createNotification(data, input, now) {
  const f = strictBody(input, ['text', 'snippet', 'type', 'task']);
  const text = typeof f.text === 'string' ? f.text.trim() : '';
  if (!text) throw bad('text is required');
  if (text.length > MAX_TEXT) throw bad(`text is over ${MAX_TEXT} characters`);
  if (f.snippet !== undefined && typeof f.snippet !== 'string') throw bad('snippet must be a string');
  if (f.snippet && f.snippet.length > MAX_SNIPPET) throw bad(`snippet is over ${MAX_SNIPPET} characters`);
  const type = f.type ?? 'comment';
  if (!TYPES.includes(type)) throw bad(`type must be one of: ${TYPES.join(', ')}`);
  const t = f.task === undefined ? null : findTask(data, f.task);
  const n = { id: 'n' + rand(), type, by: actorOf(data), text, snippet: f.snippet || '', at: now, read: false };
  if (t) n.task = t.id;
  (data.notifs ??= []).push(n);
  return n;
}

export function setRead(data, id, input) {
  const f = strictBody(input, ['read']);
  if (typeof f.read !== 'boolean') throw bad('read must be true or false');
  const n = (data.notifs || []).find(n => n.id === id);
  if (!n) throw new ApiError(404, `no notification ${id}`);
  n.read = f.read;
  return n;
}
