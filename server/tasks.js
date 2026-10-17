/* Task operations on the app's state object, mirroring what the browser app does in actions.js
   (createTask, applyPatch, archive) so API-made changes look the same as UI-made ones.
   Every function validates before it mutates, so a rejected request leaves the state untouched. */
import { cycleStart } from '../src/core/cycles.js';
import { scaleOf } from '../src/core/priorities.js';

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const bad = msg => new ApiError(400, msg);

const STATUS_NAMES = { backlog: 'Backlog', todo: 'To Do', progress: 'In Progress', review: 'Review', done: 'Done' };
const prioName = (data, id) => scaleOf(data).find(p => p.id === id)?.name;
const EDITABLE = ['title', 'desc', 'status', 'priority', 'due', 'start', 'labels', 'assignee', 'cycle', 'estimate', 'project'];

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
        out.desc = !v.trim()
          ? ''
          : v
              .trim()
              .split(/\r?\n(?:[ \t]*\r?\n)+/)
              .map(para => `<p>${esc(para).replace(/\r?\n/g, '<br>')}</p>`)
              .join('');
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
  return out;
}

function log(data, verb, t, extra, now) {
  data.activity.unshift({ id: 'a' + rand(), by: data.me, verb, task: t.id, project: t.project, at: now, extra });
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
  const fields = clean(data, prefs, today, input, EDITABLE);
  if (!fields.title) throw bad('title is required');
  const p = fields.project ? data.projects.find(p => p.id === fields.project) : data.projects.find(p => !p.archived);
  if (!p) throw bad('no project to add the task to');
  p.seq = (p.seq ?? 200) + 1;
  let id;
  do id = 't' + rand();
  while (data.tasks.some(t => t.id === id));
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
  data.tasks.push(t);
  log(data, 'created', t, '', now);
  return t;
}

export function patchTask(data, prefs, today, key, input, now) {
  const t = findTask(data, key);
  const fields = clean(data, prefs, today, input, EDITABLE);
  if (!Object.keys(fields).length) throw bad('no fields to update');
  for (const [k, nv] of Object.entries(fields)) {
    const old = t[k];
    if (JSON.stringify(old) === JSON.stringify(nv)) continue;
    t[k] = nv;
    if (k === 'status') {
      if (nv === 'done') {
        t.completedAt = now;
        t.prevStatus = old;
        log(data, 'completed', t, '', now);
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
