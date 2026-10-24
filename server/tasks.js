/* The task API on the app's state object. Creating, changing, archiving and purging go through src/core/tasks.js
   and archive.js, the same code the app runs, so API-made changes look the same as UI-made ones. What is left here
   is the API's own part: validation, defaults, description rendering, completion dates and Inbox notifications.
   Every function validates before it mutates, so a rejected request leaves the state untouched. */
import { archiveTask as archive, removeTasks } from '../src/core/archive.js';
import { STATUSES } from '../src/core/constants.js';
import { cycleStart } from '../src/core/cycles.js';
import { scaleOf } from '../src/core/priorities.js';
import { RECUR_DAYS } from '../src/core/recur.js';
import { markdownToHtml } from '../src/core/markdown.js';
import { tasksWithPr } from '../src/core/pr-links.js';
import { WORKSPACES, inWorkspace, isWorkspace } from '../src/core/workspaces.js';
import { addTask, changeTask } from '../src/core/tasks.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = msg => new ApiError(400, msg);
/* Who a write is logged to: the agent named on the request, else the workspace owner. `data.actor` exists only
   while a request is being applied (app.js mutate) and is never stored. */
export const actorOf = data => data.actor ?? data.me;
/* The `ctx` the shared changes in src/core/ take (see activity.js): the request's actor, its time, and server ids. */
export const changeCtx = (data, now) => ({ by: actorOf(data), now, newId: prefix => prefix + rand() });

export const STATUS_NAMES = Object.fromEntries(STATUSES.map(s => [s.id, s.name]));
const prioName = (data, id) => scaleOf(data).find(p => p.id === id)?.name;
const EDITABLE = [
  'title',
  'desc',
  'status',
  'priority',
  'due',
  'start',
  'labels',
  'assignee',
  'cycle',
  'estimate',
  'project',
  'completed',
  'recur',
  'descFormat',
];
// A new task cannot start out archived; an existing one is archived or restored like any other field.
const PATCHABLE = [...EDITABLE, 'archived'];

export const rand = () => Math.random().toString(36).slice(2, 8);
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const localIso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const isDate = s => {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
};

function projectOf(data, ref) {
  const r = String(ref).toLowerCase();
  return data.projects.find(p => !p.archived && (p.id.toLowerCase() === r || p.key.toLowerCase() === r));
}

/* Descriptions are stored as small HTML, which the app shows as is. Plain text (the default) is escaped, blank
   lines start paragraphs and single newlines break lines; "markdown" goes through src/core/markdown.js. */
function renderDesc(text, format) {
  if (!text.trim()) return '';
  if (format === 'markdown') return markdownToHtml(text);
  return text
    .trim()
    .split(/\r?\n(?:[ \t]*\r?\n)+/)
    .map(para => `<p>${esc(para).replace(/\r?\n/g, '<br>')}</p>`)
    .join('');
}

/* Checks the fields a caller may set and returns them in stored form. */
function clean(data, prefs, today, input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
    switch (k) {
      case 'title':
        if (typeof v !== 'string' || !v.trim()) throw bad('title must be a non-empty string');
        out.title = v.trim();
        break;
      case 'desc':
        if (typeof v !== 'string') throw bad('desc must be a string');
        out.desc = v; // rendered after the loop, once descFormat is known
        break;
      case 'descFormat':
        if (v !== 'plain' && v !== 'markdown') throw bad('descFormat must be "plain" or "markdown"');
        out.descFormat = v;
        break;
      case 'status':
        if (!Object.hasOwn(STATUS_NAMES, v)) throw bad(`status must be one of: ${Object.keys(STATUS_NAMES).join(', ')}`);
        out.status = v;
        break;
      case 'priority':
        if (!prioName(data, v))
          throw bad(
            `priority must be one of: ${scaleOf(data)
              .map(p => p.id)
              .join(', ')}`,
          );
        out.priority = v;
        break;
      case 'due':
      case 'start':
        if (v !== null && !isDate(v)) throw bad(`${k} must be YYYY-MM-DD or null`);
        out[k] = v;
        break;
      case 'labels':
        if (!Array.isArray(v) || v.some(l => typeof l !== 'string')) throw bad('labels must be an array of strings');
        out.labels = v;
        break;
      case 'assignee': {
        // A member by id, email or name, ignoring case, stored as its id.
        const r = typeof v === 'string' ? v.toLowerCase() : v;
        const m = data.members.find(m => [m.id, m.email, m.name].some(x => x && x.toLowerCase() === r));
        if (v !== null && !m) throw bad('assignee must be a member id, email or name, or null');
        out.assignee = v === null ? null : m.id;
        break;
      }
      case 'recur':
        if (v !== null && !Object.hasOwn(RECUR_DAYS, v)) throw bad(`recur must be one of: ${Object.keys(RECUR_DAYS).join(', ')}, or null`);
        out.recur = v;
        break;
      case 'archived':
        if (typeof v !== 'boolean') throw bad('archived must be true or false');
        out.archived = v;
        break;
      case 'completed':
        if (v !== null && !isDate(v)) throw bad('completed must be YYYY-MM-DD or null');
        out.completed = v;
        break;
      case 'estimate':
        if (v !== null && typeof v !== 'string') throw bad('estimate must be a string or null');
        out.estimate = v;
        break;
      case 'cycle': {
        if (v === null) out.cycle = null;
        else if (v === 'current' || isDate(v)) out.cycle = cycleStart(v === 'current' ? today : v, +(prefs?.weekStart ?? 1));
        else throw bad('cycle must be "current", YYYY-MM-DD or null');
        break;
      }
      case 'project': {
        const p = typeof v === 'string' && projectOf(data, v);
        if (!p) throw bad(`unknown project: ${v}`);
        out.project = p.id;
        break;
      }
    }
  }
  if (out.descFormat && !('desc' in out)) throw bad('descFormat needs a desc to format');
  if ('desc' in out) out.desc = renderDesc(out.desc, out.descFormat);
  delete out.descFormat;
  return out;
}

/* A completion date is stored as the app does, a timestamp; local noon keeps it on that day in any timezone. */
const completedStamp = d => {
  const [y, m, day] = d.split('-').map(Number);
  return new Date(y, m - 1, day, 12, 0, 0).getTime();
};
const needDone = status => {
  if (status !== 'done') throw bad('completed only applies to done tasks');
};

/* Tells the owner what an agent just did, in the shape the app's Inbox already shows. Nothing is raised for the
   owner's own writes. */
export function notifyOwner(data, t, type, text, snippet, now) {
  if (!data.actor || data.actor === data.me) return;
  (data.notifs ??= []).push({ id: 'n' + rand(), type, by: data.actor, task: t.id, text, snippet, at: now, read: false });
}

/* An agent writing to a task joins that task's project the first time, so its work shows up there. */
export function joinProject(data, p) {
  if (!data.actor || data.actor === data.me) return;
  p.members ??= [];
  if (!p.members.includes(data.actor)) p.members.push(data.actor);
}

export function findTask(data, key) {
  const k = String(key).toLowerCase();
  const t = data.tasks.find(t => t.key.toLowerCase() === k);
  if (!t) throw new ApiError(404, `no task ${key}`);
  return t;
}

export function listTasks(data, prefs, query, today) {
  const q = Object.fromEntries(query);
  if (q.status && !Object.hasOwn(STATUS_NAMES, q.status)) throw bad('unknown status');
  if (q.priority && !prioName(data, q.priority)) throw bad('unknown priority');
  if (q.pr && q.pr !== 'yes' && q.pr !== 'no') throw bad('pr must be yes or no');
  const withPr = q.pr ? tasksWithPr(data.comments) : null;
  if (q.workspace && !isWorkspace(q.workspace)) throw bad(`workspace must be one of: ${WORKSPACES.map(w => w.id).join(', ')}`);
  const inWs = q.workspace ? new Set(data.projects.filter(p => inWorkspace(p, q.workspace)).map(p => p.id)) : null;
  const proj = q.project ? projectOf(data, q.project) : null;
  if (q.project && !proj) throw bad(`unknown project: ${q.project}`);
  let cycle = q.cycle;
  if (cycle === 'current') cycle = cycleStart(today, +(prefs?.weekStart ?? 1));
  return data.tasks.filter(
    t =>
      (q.archived || !t.archived) &&
      (!q.status || t.status === q.status) &&
      (!q.priority || t.priority === q.priority) &&
      (!proj || t.project === proj.id) &&
      (!q.assignee || t.assignee === q.assignee) &&
      (!cycle || (cycle === 'none' ? !t.cycle : t.cycle === cycle)) &&
      (!withPr || withPr.has(t.id) === (q.pr === 'yes')) &&
      (!inWs || inWs.has(t.project)) &&
      (!q.q || t.title.toLowerCase().includes(q.q.toLowerCase()) || t.key.toLowerCase() === q.q.toLowerCase()),
  );
}

export function createTask(data, prefs, today, input, now) {
  const { completed, ...fields } = clean(data, prefs, today, input, EDITABLE);
  if (!fields.title) throw bad('title is required');
  if (completed) needDone(fields.status);
  const p = fields.project ? data.projects.find(p => p.id === fields.project) : data.projects.find(p => !p.archived);
  if (!p) throw bad('no project to add the task to');
  // The API's defaults for a new task: the backlog, assigned to whoever creates it (an agent owns its own tasks).
  const t = addTask(data, p, { status: 'backlog', assignee: actorOf(data), cycle: null, ...fields }, changeCtx(data, now));
  joinProject(data, p);
  if (completed) t.completedAt = completedStamp(completed);
  return t;
}

/* Returns { task, next }: `next` is the occurrence scheduled by completing a repeating task, if any. */
export function patchTask(data, prefs, today, key, input, now) {
  const t = findTask(data, key);
  const { completed, ...fields } = clean(data, prefs, today, input, PATCHABLE);
  if (!Object.keys(fields).length && completed === undefined) throw bad('no fields to update');
  if (completed) needDone(fields.status ?? t.status);
  const { changed, next } = changeTask(data, t, fields, changeCtx(data, now));
  joinProject(
    data,
    data.projects.find(p => p.id === t.project),
  );
  const status = changed.find(c => c.field === 'status');
  if (status) {
    const move = `${STATUS_NAMES[status.from]} → ${STATUS_NAMES[t.status]}`;
    notifyOwner(data, t, 'update', t.status === 'done' ? 'completed' : `moved to ${STATUS_NAMES[t.status]}`, move, now);
  }
  if (completed !== undefined) {
    t.completedAt = completed ? completedStamp(completed) : null;
    t.updated = now;
  }
  return { task: t, next };
}

/* Permanent delete. Only for tasks already archived, so removing one is always two deliberate steps. */
export function purgeTask(data, key) {
  const t = findTask(data, key);
  if (!t.archived) throw new ApiError(409, `${t.key} is not archived: archive it first (DELETE without purge), then purge`);
  removeTasks(data, [t.id]);
  return t;
}

export function archiveTask(data, key, now) {
  const t = findTask(data, key);
  archive(data, t, changeCtx(data, now));
  return t;
}
