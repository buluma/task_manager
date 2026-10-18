/* Subtasks and dependencies of a task. Subtask changes go through src/core/subtasks.js, as the app's do; the
   dependency routes mirror the dependency picker in the app. Dependencies are stored as task ids (as the app
   does) and spoken as task keys on the API. */
import { addSub, removeSub, renameSub, setSubDone } from '../src/core/subtasks.js';
import { ApiError, actorOf, bad, changeCtx, findTask, rand } from './tasks.js';

const MAX_TITLE = 500;

const strictBody = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  return input;
};
const cleanTitle = title => {
  if (typeof title !== 'string' || !title.trim()) throw bad('title must be a non-empty string');
  if (title.trim().length > MAX_TITLE) throw bad(`title must be at most ${MAX_TITLE} characters`);
  return title.trim();
};
const act = (data, verb, t, extra, now) => {
  data.activity.unshift({ id: 'a' + rand(), by: actorOf(data), verb, task: t.id, project: t.project, at: now, extra });
  t.updated = now;
};
const subOf = (t, sid) => {
  const s = (t.subtasks || []).find(x => x.id === sid);
  if (!s) throw new ApiError(404, `no subtask ${sid} on ${t.key}`);
  return s;
};

export function addSubtask(data, key, input, now) {
  const { title } = strictBody(input, ['title']);
  const clean = cleanTitle(title);
  return addSub(data, findTask(data, key), clean, changeCtx(data, now));
}

export function patchSubtask(data, key, sid, input, now) {
  const f = strictBody(input, ['title', 'done']);
  if (!Object.keys(f).length) throw bad('no fields to update');
  const title = 'title' in f ? cleanTitle(f.title) : undefined;
  if ('done' in f && typeof f.done !== 'boolean') throw bad('done must be true or false');
  const t = findTask(data, key);
  const s = subOf(t, sid);
  if (title !== undefined) renameSub(t, s, title, now);
  if ('done' in f) setSubDone(data, t, s, f.done, changeCtx(data, now));
  t.updated = now;
  return s;
}

export function deleteSubtask(data, key, sid, now) {
  const t = findTask(data, key);
  const s = subOf(t, sid);
  removeSub(t, s, now);
  return s;
}

const depView = (data, t) =>
  (t.deps || [])
    .map(id => data.tasks.find(x => x.id === id))
    .filter(Boolean)
    .map(x => ({ key: x.key, title: x.title, status: x.status }));

export const listDeps = (data, key) => depView(data, findTask(data, key));

export function addDep(data, key, input, now) {
  const { on } = strictBody(input, ['on']);
  if (typeof on !== 'string' || !on.trim()) throw bad('on must be the key of the task this one depends on');
  const t = findTask(data, key);
  const other = findTask(data, on);
  if (other.id === t.id) throw bad('a task cannot depend on itself');
  if ((t.deps || []).includes(other.id)) throw bad(`${t.key} already depends on ${other.key}`);
  (t.deps ??= []).push(other.id);
  act(data, 'updated dependencies of', t, '', now);
  return depView(data, t);
}

export function removeDep(data, key, onKey, now) {
  const t = findTask(data, key);
  const other = findTask(data, onKey);
  if (!(t.deps || []).includes(other.id)) throw new ApiError(404, `${t.key} does not depend on ${other.key}`);
  t.deps = t.deps.filter(id => id !== other.id);
  act(data, 'updated dependencies of', t, '', now);
  return depView(data, t);
}
