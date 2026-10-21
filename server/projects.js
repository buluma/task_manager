/* The project API on the app's state object. Creating, changing, archiving and purging go through
   src/core/projects.js and archive.js, the same code the app runs; this module validates and picks the API's defaults.
   Like tasks.js, every function validates before it mutates. Deleting archives, so the app can restore it. */
import { archiveProject as archive, removeProject } from '../src/core/archive.js';
import { addProject, changeProject, repoName } from '../src/core/projects.js';
import { PCOLORS, PSTAT } from '../src/core/constants.js';
import { ApiError, bad, changeCtx, isDate } from './tasks.js';

const CREATE = ['name', 'key', 'desc', 'color', 'icon', 'status', 'due', 'lead', 'repo'];
const EDITABLE = ['name', 'desc', 'color', 'icon', 'status', 'due', 'lead', 'repo', 'archived'];

export function findProject(data, ref) {
  const r = String(ref).toLowerCase();
  const p = data.projects.find(p => p.id.toLowerCase() === r || p.key.toLowerCase() === r);
  if (!p) throw new ApiError(404, `no project ${ref}`);
  return p;
}

export const listProjects = (data, query) => data.projects.filter(p => query.get('archived') || !p.archived).map(p => ({ ...p }));

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
      case 'repo':
        if (v !== null && (typeof v !== 'string' || !repoName(v))) throw bad('repo must be a GitHub repo as OWNER/NAME (or its github.com URL), or null');
        out.repo = v === null ? null : repoName(v);
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
  const lead = f.lead || data.me;
  // The API's defaults: a folder in indigo, planning, no due date, in the lead's team.
  return addProject(
    data,
    {
      key: f.key,
      name: f.name,
      icon: f.icon || 'folder',
      color: f.color || 'indigo',
      status: f.status || 'planning',
      team: data.members.find(m => m.id === lead)?.team ?? '',
      lead,
      due: f.due ?? null,
      start: today,
      desc: f.desc || '',
      repo: f.repo ?? null,
    },
    changeCtx(data, now),
  );
}

export function patchProject(data, ref, input, now) {
  const p = findProject(data, ref);
  const f = clean(data, input, EDITABLE);
  if (!Object.keys(f).length) throw bad('no fields to update');
  return changeProject(data, p, f, changeCtx(data, now));
}

export function archiveProject(data, ref, now) {
  const p = findProject(data, ref);
  archive(p, now);
  return p;
}

/* Permanent delete (see removeProject). Only for a project already archived. */
export function purgeProject(data, ref) {
  const p = findProject(data, ref);
  if (!p.archived) throw new ApiError(409, `${p.key} is not archived: archive it first (DELETE without purge), then purge`);
  return { project: p, tasks: removeProject(data, p) };
}
