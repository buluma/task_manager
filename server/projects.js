/* Project operations on the app's state object, mirroring createProject / archiveProject in actions.js.
   Like tasks.js, every function validates before it mutates. Deleting archives, so the app can restore it. */
import { PCOLORS, PSTAT } from '../src/core/constants.js';
import { ApiError, bad, isDate, rand, removeTasks } from './tasks.js';

const CREATE = ['name', 'key', 'desc', 'color', 'icon', 'status', 'due', 'lead'];
const EDITABLE = ['name', 'desc', 'color', 'icon', 'status', 'due', 'lead', 'archived'];

export function findProject(data, ref) {
  const r = String(ref).toLowerCase();
  const p = data.projects.find(p => p.id.toLowerCase() === r || p.key.toLowerCase() === r);
  if (!p) throw new ApiError(404, `no project ${ref}`);
  return p;
}

export const listProjects = (data, query) => data.projects.filter(p => query.get('archived') || !p.archived).map(p => ({ ...p }));

/* The app's makeKey: initials of the words, padded from the letters, made unique with trailing X. */
function makeKey(data, name) {
  let k = name
    .split(/\s+/)
    .map(w => w[0] || '')
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  if (k.length < 2)
    k =
      name
        .replace(/[^A-Za-z]/g, '')
        .slice(0, 3)
        .toUpperCase() || 'PRJ';
  while (data.projects.some(p => p.key === k)) k += 'X';
  return k;
}

function clean(data, input, allowed) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  const out = {};
  for (const [k, v] of Object.entries(input)) {
    if (k === 'key' && !allowed.includes(k)) throw bad('key cannot be changed: tasks already carry it');
    if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
    switch (k) {
      case 'name':
        if (typeof v !== 'string' || !v.trim()) throw bad('name must be a non-empty string');
        out.name = v.trim();
        break;
      case 'key': {
        const key = typeof v === 'string' ? v.toUpperCase() : '';
        if (!/^[A-Z][A-Z0-9]{1,5}$/.test(key)) throw bad('key must be 2-6 letters or digits, starting with a letter');
        if (data.projects.some(p => p.key === key)) throw bad(`key ${key} is already used`);
        out.key = key;
        break;
      }
      case 'desc':
        if (typeof v !== 'string') throw bad('desc must be a string');
        out.desc = v;
        break;
      case 'color':
        if (!Object.hasOwn(PCOLORS, v)) throw bad(`color must be one of: ${Object.keys(PCOLORS).join(', ')}`);
        out.color = v;
        break;
      case 'icon':
        if (typeof v !== 'string' || !/^[a-z][a-z0-9-]{0,39}$/.test(v)) throw bad('icon must be a Lucide icon name such as "folder"');
        out.icon = v;
        break;
      case 'status':
        if (!Object.hasOwn(PSTAT, v)) throw bad(`status must be one of: ${Object.keys(PSTAT).join(', ')}`);
        out.status = v;
        break;
      case 'due':
        if (v !== null && !isDate(v)) throw bad('due must be YYYY-MM-DD or null');
        out.due = v;
        break;
      case 'lead':
        if (!data.members.some(m => m.id === v)) throw bad('lead must be a member id');
        out.lead = v;
        break;
      case 'archived':
        if (typeof v !== 'boolean') throw bad('archived must be true or false');
        out.archived = v;
        break;
    }
  }
  return out;
}

export function createProject(data, today, input, now) {
  const f = clean(data, input, CREATE);
  if (!f.name) throw bad('name is required');
  const key = f.key || makeKey(data, f.name);
  const lead = f.lead || data.me;
  let id;
  do id = 'p' + rand();
  while (data.projects.some(p => p.id === id));
  const p = {
    id,
    key,
    seq: 0,
    name: f.name,
    icon: f.icon || 'folder',
    color: f.color || 'indigo',
    status: f.status || 'planning',
    team: data.members.find(m => m.id === lead)?.team ?? '',
    lead,
    due: f.due ?? null,
    start: today,
    fav: false,
    members: [...new Set([data.me, lead])],
    desc: f.desc || '',
    milestones: [],
    last: 0,
  };
  data.projects.push(p);
  (data.projOrder ??= []).unshift(p.id);
  data.activity.unshift({ id: 'a' + rand(), by: data.me, verb: 'created project', task: null, project: p.id, at: now, extra: '' });
  return p;
}

export function patchProject(data, ref, input, now) {
  const p = findProject(data, ref);
  const f = clean(data, input, EDITABLE);
  if (!Object.keys(f).length) throw bad('no fields to update');
  for (const [k, v] of Object.entries(f)) {
    if (JSON.stringify(p[k]) === JSON.stringify(v)) continue;
    if (k === 'archived') {
      p.archived = v;
      p.archivedAt = v ? now : null;
      continue;
    }
    p[k] = v;
    if (k === 'lead' && !p.members.includes(v)) p.members.push(v);
    if (k === 'status')
      data.activity.unshift({
        id: 'a' + rand(),
        by: data.me,
        verb: 'changed status of project',
        task: null,
        project: p.id,
        at: now,
        extra: 'to ' + PSTAT[v].name,
      });
  }
  return p;
}

export function archiveProject(data, ref, now) {
  const p = findProject(data, ref);
  if (!p.archived) {
    p.archived = true;
    p.archivedAt = now;
  }
  return p;
}

/* Permanent delete, like the app's: the project, every task in it (archived ones too) with their comments and
   dependency links, and its files. Only for a project already archived. Returns how many tasks went with it. */
export function purgeProject(data, ref) {
  const p = findProject(data, ref);
  if (!p.archived) throw new ApiError(409, `${p.key} is not archived: archive it first (DELETE without purge), then purge`);
  const ids = data.tasks.filter(t => t.project === p.id).map(t => t.id);
  removeTasks(data, ids);
  data.projects = data.projects.filter(x => x !== p);
  if (data.projOrder) data.projOrder = data.projOrder.filter(id => id !== p.id);
  if (data.files) data.files = data.files.filter(f => f.project !== p.id);
  if (data.activity) data.activity = data.activity.filter(a => a.project !== p.id);
  return { project: p, tasks: ids.length };
}
