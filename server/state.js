/* The storage boundary: upgrade unversioned workspaces, then validate before accepting them. */
import { DEFAULT_PRIOS, PSTAT, ST } from '../src/core/constants.js';

export const STATE_VERSION = 1;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (path, why) => {
  throw new Error(`${path}: ${why}`);
};
const need = (ok, path, why) => {
  if (!ok) fail(path, why);
};
const text = (v, p) => need(typeof v === 'string', p, 'expected a string');
const nonempty = (v, p) => {
  text(v, p);
  need(v.trim().length > 0, p, 'must not be empty');
};
const obj = (v, p) => need(object(v), p, 'expected an object');
const array = (v, p) => need(Array.isArray(v), p, 'expected an array');
function records(list, p) {
  array(list, p);
  const ids = new Set();
  for (const [i, record] of list.entries()) {
    obj(record, `${p}[${i}]`);
    nonempty(record.id, `${p}[${i}].id`);
    need(!ids.has(record.id), p, `duplicate id ${record.id}`);
    ids.add(record.id);
  }
  return ids;
}
function strings(list, p) {
  array(list, p);
  list.forEach((v, i) => text(v, `${p}[${i}]`));
}
function date(v, p) {
  if (v == null) return;
  need(
    typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    p,
    'expected a calendar date or null',
  );
}
function filters(value, path) {
  array(value, path);
  for (const filter of value) {
    obj(filter, path);
    nonempty(filter.f, `${path}.f`);
    need(['is', 'not'].includes(filter.op), `${path}.op`, 'unknown filter operator');
    strings(filter.v, `${path}.v`);
  }
}
function validateView(value, path) {
  obj(value, path);
  if (value.filters !== undefined) filters(value.filters, `${path}.filters`);
  if (value.sort !== undefined) {
    obj(value.sort, `${path}.sort`);
    nonempty(value.sort.f, `${path}.sort.f`);
    need([1, -1].includes(value.sort.dir), `${path}.sort.dir`, 'expected 1 or -1');
  }
  fields(value, path, ['q', 'group', 'type', 'name']);
  if (value.hidden !== undefined) strings(value.hidden, `${path}.hidden`);
  if (value.colW !== undefined) obj(value.colW, `${path}.colW`);
}
function fields(record, path, names) {
  for (const key of names) if (record[key] !== undefined && record[key] !== null) text(record[key], `${path}.${key}`);
}

export function normalizeState(input) {
  obj(input, 'state');
  obj(input.data, 'data');
  const state = structuredClone(input);
  const d = state.data;
  const version = state.schemaVersion ?? 0;
  need(Number.isInteger(version) && version >= 0 && version <= STATE_VERSION, 'schemaVersion', 'unsupported workspace version');
  // These collections and identity existed in the first release: never invent them to repair a broken save.
  array(d.tasks, 'data.tasks');
  array(d.projects, 'data.projects');
  array(d.members, 'data.members');
  nonempty(d.me, 'data.me');
  if (version === 0) {
    if (d.ws === undefined) d.ws = { name: 'My Workspace', c: '#1D1C1A', brand: true };
    for (const key of ['comments', 'activity', 'notifs', 'events', 'savedViews', 'recentSearches']) if (d[key] === undefined) d[key] = [];
    if (d.projOrder === undefined) d.projOrder = d.projects.map(p => p.id);
    if (state.prefs === undefined) state.prefs = {};
    if (state.views === undefined) state.views = {};
    for (const p of d.projects) {
      obj(p, 'project');
      for (const [key, value] of Object.entries({ status: 'active', members: [d.me], milestones: [], desc: '', icon: 'folder', color: 'slate' }))
        if (p[key] === undefined) p[key] = value;
    }
    for (const t of d.tasks) {
      obj(t, 'task');
      for (const [key, value] of Object.entries({ labels: [], deps: [], subtasks: [], desc: '', priority: 'none' })) if (t[key] === undefined) t[key] = value;
    }
  }
  state.schemaVersion = STATE_VERSION;
  obj(d.ws, 'data.ws');
  nonempty(d.ws.name, 'data.ws.name');
  fields(d.ws, 'data.ws', ['c']);
  obj(state.prefs, 'prefs');
  fields(state.prefs, 'prefs', ['theme', 'accent', 'side', 'density', 'dateFmt', 'motion', 'home', 'openTasks', 'name', 'title']);
  obj(state.views, 'views');
  for (const [key, value] of Object.entries(state.prefs)) {
    need(['string', 'number', 'boolean'].includes(typeof value) || value === null, `prefs.${key}`, 'expected a scalar preference');
    if (key === 'weekStart') need([0, 1, '0', '1'].includes(value), 'prefs.weekStart', 'expected Sunday (0) or Monday (1)');
  }
  for (const [key, view] of Object.entries(state.views)) {
    validateView(view, `views.${key}`);
  }
  const members = records(d.members, 'data.members');
  const projects = records(d.projects, 'data.projects');
  const tasks = records(d.tasks, 'data.tasks');
  need(members.has(d.me), 'data.me', 'unknown member');
  const projectKeys = new Set(),
    taskKeys = new Set();
  for (const p of d.projects) {
    nonempty(p.name, 'project.name');
    nonempty(p.key, 'project.key');
    need(!projectKeys.has(p.key.toUpperCase()), 'project.key', 'duplicate project key');
    projectKeys.add(p.key.toUpperCase());
    need(Object.hasOwn(PSTAT, p.status), 'project.status', 'unknown status');
    strings(p.members, 'project.members');
    need(
      p.members.every(id => members.has(id)),
      'project.members',
      'unknown member',
    );
    array(p.milestones, 'project.milestones');
    for (const m of p.milestones) {
      obj(m, 'milestone');
      nonempty(m.name, 'milestone.name');
      date(m.date, 'milestone.date');
    }
    fields(p, 'project', ['desc', 'icon', 'color', 'team', 'lead', 'repo', 'workspace']);
    date(p.start, 'project.start');
    date(p.due, 'project.due');
    if (p.seq !== undefined) need(Number.isSafeInteger(p.seq) && p.seq >= 0, 'project.seq', 'expected a nonnegative integer');
  }
  let priorities = new Set(DEFAULT_PRIOS.map(p => p.id));
  if (d.priorities !== undefined) {
    priorities = records(d.priorities, 'data.priorities');
    priorities.add('none');
    for (const p of d.priorities) {
      nonempty(p.name, 'priority.name');
      need(Number.isFinite(p.w), 'priority.w', 'expected a number');
    }
  }
  for (const m of d.members) {
    nonempty(m.name, 'member.name');
    fields(m, 'member', ['email', 'role', 'team', 'title', 'c', 'tz']);
  }
  for (const t of d.tasks) {
    nonempty(t.title, 'task.title');
    nonempty(t.key, 'task.key');
    need(!taskKeys.has(t.key.toUpperCase()), 'task.key', 'duplicate task key');
    taskKeys.add(t.key.toUpperCase());
    need(projects.has(t.project), 'task.project', 'unknown project');
    need(t.assignee == null || members.has(t.assignee), 'task.assignee', 'unknown member');
    need(Object.hasOwn(ST, t.status), 'task.status', 'unknown status');
    need(priorities.has(t.priority), 'task.priority', 'unknown priority');
    strings(t.labels, 'task.labels');
    strings(t.deps, 'task.deps');
    need(
      t.deps.every(id => id !== t.id && tasks.has(id)),
      'task.deps',
      'unknown or self dependency',
    );
    records(t.subtasks, 'task.subtasks');
    for (const sub of t.subtasks) {
      nonempty(sub.title, 'subtask.title');
      need(typeof sub.done === 'boolean', 'subtask.done', 'expected a boolean');
    }
    fields(t, 'task', ['desc', 'recur', 'estimate']);
    for (const key of ['due', 'start', 'cycle']) date(t[key], `task.${key}`);
  }
  for (const key of ['comments', 'activity', 'notifs', 'events', 'savedViews']) records(d[key], `data.${key}`);
  for (const c of d.comments) {
    need(tasks.has(c.task), 'comment.task', 'unknown task');
    text(c.text, 'comment.text');
  }
  for (const saved of d.savedViews) validateView(saved, 'savedView');
  for (const e of d.events) {
    text(e.title, 'event.title');
    date(e.date, 'event.date');
  }
  for (const n of d.notifs) fields(n, 'notification', ['type', 'text', 'snippet']);
  for (const a of d.activity) fields(a, 'activity', ['verb', 'extra']);
  // Activity, Inbox, saved views and events may outlive a purged task/project or a removed author.
  strings(d.projOrder, 'data.projOrder');
  need(new Set(d.projOrder).size === d.projOrder.length && d.projOrder.every(id => projects.has(id)), 'data.projOrder', 'duplicate or unknown project');
  strings(d.recentSearches, 'data.recentSearches');
  if (d.teams !== undefined) {
    records(d.teams, 'data.teams');
    for (const t of d.teams) nonempty(t.name, 'team.name');
  }
  if (d.labels !== undefined) {
    records(d.labels, 'data.labels');
    for (const l of d.labels) {
      nonempty(l.name, 'label.name');
      nonempty(l.color, 'label.color');
    }
  }
  return state;
}
