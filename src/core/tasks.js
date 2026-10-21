/* ---------- creating and changing tasks ----------
   Shared by the app (actions.js: createTask, applyPatch) and the server (server/tasks.js: POST and PATCH
   /api/tasks), so a task made or edited from either side is stored and logged alike. Callers check their input
   first and pick their own defaults for a new task (the API's differ from the app's); `ctx` is as in activity.js.
   What only one side does stays there: the app's highlight effects and toasts, the API's validation, description
   rendering, backdated completion dates and Inbox notifications for agents. */
import { logActivity as log } from './activity.js';
import { archiveTask, restoreTask } from './archive.js';
import { ST } from './constants.js';
import { scaleOf } from './priorities.js';
import { nextDue } from './recur.js';

/* The next key in a project. Counters start after 200 for a project that has none yet. */
export function nextKey(p) {
  p.seq = (p.seq ?? 200) + 1;
  return p.key + '-' + p.seq;
}

/* A new scheduled task (To Do, In Progress or Review) starts the day it is made and is due three days later. A date
   given is kept (start moves back to an earlier due, due forward from a later start), and null means none on purpose.
   A task made in the backlog is not scheduled yet, and one made closed (an import) is history: neither gets dates. */
const DUE_IN = 3;
// the local day of a timestamp, and day arithmetic in UTC (as recur.js) so a DST change can't shift it
const dayOf = ms => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const plusDays = (day, n) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
};
function defaultDates(fields, now) {
  if (['backlog', 'done', 'cancelled'].includes(fields.status)) return {};
  const today = dayOf(now);
  const out = {};
  if (fields.start === undefined) out.start = fields.due && fields.due < today ? fields.due : today;
  const from = fields.start ?? out.start ?? today;
  if (fields.due === undefined) out.due = plusDays(from > today ? from : today, DUE_IN);
  return out;
}

/* A new task in project `p`, last in the order. `fields` override the defaults; an `id` or `key` given is kept. */
export function addTask(data, p, fields, ctx) {
  let id = fields.id;
  if (!id)
    do id = ctx.newId('t');
    while (data.tasks.some(t => t.id === id));
  const t = {
    title: 'Untitled',
    status: 'todo',
    assignee: null,
    priority: 'none',
    due: null,
    start: null,
    labels: [],
    subtasks: [],
    deps: [],
    desc: '',
    estimate: null,
    fav: false,
    recur: null,
    created: ctx.now,
    updated: ctx.now,
    order: Math.max(0, ...data.tasks.map(x => x.order || 0)) + 1,
    ...defaultDates(fields, ctx.now),
    ...fields,
    id,
    project: p.id,
  };
  t.key = fields.key || nextKey(p);
  data.tasks.push(t);
  log(data, ctx, 'created', t);
  return t;
}

/* The occurrence after a repeating task: a copy that starts over, due one repeat later, stamped as new. */
function scheduleNext(data, t, ctx) {
  const due = nextDue(t.due, t.recur);
  const copy = structuredClone(t);
  for (const k of ['id', 'key', 'completedAt', 'prevStatus', 'created', 'updated', 'order']) delete copy[k];
  return addTask(
    data,
    data.projects.find(p => p.id === t.project),
    { ...copy, status: 'todo', due, start: due, subtasks: (t.subtasks || []).map(s => ({ ...s, done: false })) },
    ctx,
  );
}

const name = s => ST[s]?.name ?? s;

/* Applies `patch` to `t`, logging each field that actually changes. Returns `changed` ([{ field, from }], in
   patch order) and `next`, the occurrence scheduled by completing a repeating task, if any. */
export function changeTask(data, t, patch, ctx) {
  const changed = [];
  let next;
  for (const [k, nv] of Object.entries(patch)) {
    const old = t[k];
    if (JSON.stringify(old) === JSON.stringify(nv)) continue;
    changed.push({ field: k, from: old });
    if (k === 'archived') {
      (nv ? archiveTask : restoreTask)(data, t, ctx);
      continue;
    }
    t[k] = nv;
    if (k === 'status') {
      if (nv === 'done') {
        t.completedAt = ctx.now;
        t.prevStatus = old;
        log(data, ctx, 'completed', t);
        if (t.recur && t.due && !t.archived) next = scheduleNext(data, t, ctx);
      } else log(data, ctx, 'moved', t, `from ${name(old)} to ${name(nv)}`);
    } else if (k === 'project') {
      const p = data.projects.find(p => p.id === nv);
      t.key = nextKey(p);
      log(data, ctx, 'moved', t, `to ${p.name}`);
    } else if (k === 'assignee') log(data, ctx, 'assigned', t, nv ? `to ${data.members.find(m => m.id === nv)?.name}` : '(unassigned)');
    else if (k === 'priority') log(data, ctx, 'changed priority of', t, `to ${scaleOf(data).find(p => p.id === nv)?.name}`);
    // Dates are logged as YYYY-MM-DD: the activity text is stored, so a display format would be frozen into it.
    else if (k === 'due') log(data, ctx, 'changed due date of', t, nv ? `to ${nv}` : '(cleared)');
    else if (k === 'start') log(data, ctx, 'changed start date of', t, nv ? `to ${nv}` : '(cleared)');
    else if (k === 'labels') log(data, ctx, 'updated labels on', t);
    else if (k === 'title') log(data, ctx, 'renamed', t, `to “${nv}”`);
    else if (k === 'recur') log(data, ctx, 'set repeat on', t, nv ? nv.toLowerCase() : 'off');
    else if (k === 'estimate') log(data, ctx, 'estimated', t, nv || 'none');
    else if (k === 'deps') log(data, ctx, 'updated dependencies of', t);
    else if (k === 'cycle') log(data, ctx, nv ? 'added to this cycle' : 'removed from its cycle', t);
    t.updated = ctx.now;
  }
  return { changed, next };
}
