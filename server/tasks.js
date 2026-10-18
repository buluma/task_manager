/* Task operations on the app's state object, mirroring what the browser app does in actions.js
   (createTask, applyPatch, archive) so API-made changes look the same as UI-made ones.
   Every function validates before it mutates, so a rejected request leaves the state untouched. */
import { cycleStart } from '../src/core/cycles.js';
import { scaleOf } from '../src/core/priorities.js';
import { markdownToHtml } from './markdown.js';

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

const STATUS_NAMES = { backlog: 'Backlog', todo: 'To Do', progress: 'In Progress', review: 'Review', done: 'Done', cancelled: 'Cancelled' };
const prioName = (data, id) => scaleOf(data).find(p => p.id === id)?.name;
/* Days between occurrences of a repeating task, as in the app (actions.js). */
const RECUR_DAYS = { Daily: 1, Weekly: 7, 'Every 2 weeks': 14, Monthly: 30 };
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
   lines start paragraphs and single newlines break lines; "markdown" goes through markdown.js. */
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
      case 'assignee':
        if (v !== null && !data.members.some(m => m.id === v)) throw bad('assignee must be a member id or null');
        out.assignee = v;
        break;
      case 'recur':
        if (v !== null && !Object.hasOwn(RECUR_DAYS, v)) throw bad(`recur must be one of: ${Object.keys(RECUR_DAYS).join(', ')}, or null`);
        out.recur = v;
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

const addDays = (isoDate, n) => {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
const newTaskId = data => {
  let id;
  do id = 't' + rand();
  while (data.tasks.some(t => t.id === id));
  return id;
};

function log(data, verb, t, extra, now) {
  data.activity.unshift({ id: 'a' + rand(), by: actorOf(data), verb, task: t.id, project: t.project, at: now, extra });
  t.updated = now;
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
      (!q.q || t.title.toLowerCase().includes(q.q.toLowerCase()) || t.key.toLowerCase() === q.q.toLowerCase()),
  );
}

export function createTask(data, prefs, today, input, now) {
  const { completed, ...fields } = clean(data, prefs, today, input, EDITABLE);
  if (!fields.title) throw bad('title is required');
  if (completed) needDone(fields.status);
  const p = fields.project ? data.projects.find(p => p.id === fields.project) : data.projects.find(p => !p.archived);
  if (!p) throw bad('no project to add the task to');
  p.seq = (p.seq ?? 200) + 1;
  const id = newTaskId(data);
  const t = {
    status: 'backlog',
    assignee: data.me,
    priority: 'none',
    due: null,
    start: null,
    labels: [],
    subtasks: [],
    attachments: [],
    deps: [],
    desc: '',
    estimate: null,
    cycle: null,
    fav: false,
    recur: null,
    ...fields,
    id,
    key: `${p.key}-${p.seq}`,
    project: p.id,
    created: now,
    updated: now,
    order: Math.max(0, ...data.tasks.map(x => x.order || 0)) + 1,
  };
  if (completed) t.completedAt = completedStamp(completed);
  data.tasks.push(t);
  log(data, 'created', t, '', now);
  return t;
}

/* Like the app: completing a repeating task that has a due date schedules the next one, a copy that starts over. */
function spawnNext(data, t, now) {
  const p = data.projects.find(x => x.id === t.project);
  const due = addDays(t.due, RECUR_DAYS[t.recur] || 7);
  p.seq = (p.seq ?? 200) + 1;
  const next = {
    ...structuredClone(t),
    id: newTaskId(data),
    key: `${p.key}-${p.seq}`,
    status: 'todo',
    due,
    start: due,
    subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })),
    attachments: [],
    created: now,
    updated: now,
    order: Math.max(0, ...data.tasks.map(x => x.order || 0)) + 1,
  };
  delete next.completedAt;
  delete next.prevStatus;
  data.tasks.push(next);
  log(data, 'created', next, '', now);
  return next;
}

/* Returns { task, next }: `next` is the occurrence scheduled by completing a repeating task, if any. */
export function patchTask(data, prefs, today, key, input, now) {
  const t = findTask(data, key);
  let next;
  const { completed, ...fields } = clean(data, prefs, today, input, EDITABLE);
  if (!Object.keys(fields).length && completed === undefined) throw bad('no fields to update');
  if (completed) needDone(fields.status ?? t.status);
  for (const [k, nv] of Object.entries(fields)) {
    const old = t[k];
    if (JSON.stringify(old) === JSON.stringify(nv)) continue;
    t[k] = nv;
    if (k === 'status') {
      if (nv === 'done') {
        t.completedAt = now;
        t.prevStatus = old;
        log(data, 'completed', t, '', now);
        if (t.recur && t.due && !t.archived) next = spawnNext(data, t, now);
      } else log(data, 'moved', t, `from ${STATUS_NAMES[old]} to ${STATUS_NAMES[nv]}`, now);
    } else if (k === 'project') {
      // Like the app: re-key from the target project's counter, so the old key stops resolving.
      const p = data.projects.find(p => p.id === nv);
      p.seq = (p.seq ?? 200) + 1;
      t.key = `${p.key}-${p.seq}`;
      log(data, 'moved', t, `to ${p.name}`, now);
    } else if (k === 'assignee') log(data, 'assigned', t, nv ? `to ${data.members.find(m => m.id === nv).name}` : '(unassigned)', now);
    else if (k === 'priority') log(data, 'changed priority of', t, `to ${prioName(data, nv)}`, now);
    else if (k === 'due') log(data, 'changed due date of', t, nv ? `to ${nv}` : '(cleared)', now);
    else if (k === 'start') log(data, 'changed start date of', t, nv ? `to ${nv}` : '(cleared)', now);
    else if (k === 'labels') log(data, 'updated labels on', t, '', now);
    else if (k === 'title') log(data, 'renamed', t, `to “${nv}”`, now);
    else if (k === 'estimate') log(data, 'estimated', t, nv || 'none', now);
    else if (k === 'cycle') log(data, nv ? 'added to this cycle' : 'removed from its cycle', t, '', now);
    t.updated = now;
  }
  if (completed !== undefined) {
    t.completedAt = completed ? completedStamp(completed) : null;
    t.updated = now;
  }
  return { task: t, next };
}

/* Mirrors deleteTasks in the app: the tasks, dependency links pointing at them, and their comments. */
export function removeTasks(data, ids) {
  const gone = new Set(ids);
  data.tasks = data.tasks.filter(t => !gone.has(t.id));
  for (const t of data.tasks) if (t.deps) t.deps = t.deps.filter(d => !gone.has(d));
  if (data.comments) data.comments = data.comments.filter(c => !gone.has(c.task));
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
  if (!t.archived) {
    t.archived = true;
    t.archivedAt = now;
    log(data, 'archived', t, '', now);
  }
  return t;
}
