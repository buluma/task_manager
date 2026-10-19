/* ---------- creating and changing projects ----------
   Shared by the app (actions.js: createProject, the project dialog, the status menu) and the server
   (server/projects.js: POST and PATCH /api/projects), so a project made or edited from either side is stored and
   logged alike. Callers check their input first and pass every field of a new project: the app's defaults (a due
   date a month out, "No description yet.") differ from the API's. `ctx` is as in activity.js. */
import { logProjectActivity as log } from './activity.js';
import { archiveProject, restoreProject } from './archive.js';
import { PSTAT } from './constants.js';

/* Initials of the words, padded from the letters when short, made unique with trailing X. */
export function makeKey(data, name) {
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

/* A new project, first in the sidebar, with you and its lead as members. Its tasks are numbered from 1. */
export function addProject(data, { key, name, icon, color, status, team, lead, due, start, desc }, ctx) {
  let id;
  do id = ctx.newId('p');
  while (data.projects.some(p => p.id === id));
  const p = {
    id,
    key: key || makeKey(data, name),
    seq: 0,
    name,
    icon,
    color,
    status,
    team,
    lead,
    due,
    start,
    fav: false,
    members: [...new Set([data.me, lead])],
    desc,
    milestones: [],
    last: 0,
  };
  data.projects.push(p);
  (data.projOrder ??= []).unshift(p.id);
  log(data, ctx, 'created project', p);
  return p;
}

/* Applies `patch` to `p`, skipping what did not change. A new lead joins the members; a status change is logged. */
export function changeProject(data, p, patch, ctx) {
  for (const [k, v] of Object.entries(patch)) {
    if (JSON.stringify(p[k]) === JSON.stringify(v)) continue;
    if (k === 'archived') {
      if (v) archiveProject(p, ctx.now);
      else restoreProject(p);
      continue;
    }
    p[k] = v;
    if (k === 'lead' && !p.members.includes(v)) p.members.push(v);
    if (k === 'status') log(data, ctx, 'changed status of project', p, 'to ' + PSTAT[v].name);
  }
  return p;
}
