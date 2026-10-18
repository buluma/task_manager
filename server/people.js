/* Members, teams and project milestones. Member and team changes go through src/core/members.js and teams.js, as
   the app's do, under the app's rules: Admin, Member and Guest can be given; the Owner keeps their role and, like
   you, cannot be removed; agents keep the Agent role. The app does not log these changes, so neither does the API.
   Milestones ({ name, date } on a project) have no editor in the app; the API is their only writer. */
import { PCOLORS, TEAMS_SEED } from '../src/core/constants.js';
import { addMembers, removeMember } from '../src/core/members.js';
import { addTeam, removeTeam, setTeamMembers, teamsOf } from '../src/core/teams.js';
import { findProject } from './projects.js';
import { ApiError, bad, isDate, rand } from './tasks.js';

const ROLES = ['Admin', 'Member', 'Guest'];
const EMAIL = /^\S+@\S+\.\S+$/;
const ICON = /^[a-z0-9-]{1,40}$/;
const MAX_NAME = 80;
const newId = prefix => prefix + rand();

const body = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  return input;
};
const text = (v, field, { required = true } = {}) => {
  if (typeof v !== 'string' || (required && !v.trim())) throw bad(`${field} must be a non-empty string`);
  if (v.trim().length > MAX_NAME) throw bad(`${field} must be at most ${MAX_NAME} characters`);
  return v.trim();
};
const role = v => {
  if (!ROLES.includes(v)) throw bad(`role must be one of: ${ROLES.join(', ')}`);
  return v;
};

/* ---------- members ---------- */

export const listMembers = data => data.members;

/* By id or email, ignoring case. */
export function findMember(data, ref) {
  const r = String(ref).toLowerCase();
  const m = data.members.find(m => m.id.toLowerCase() === r || (m.email && m.email.toLowerCase() === r));
  if (!m) throw new ApiError(404, `no member ${ref}`);
  return m;
}

/* A team named by id or name ('' or null means none), as stored on a member or project. */
const teamRef = (data, v) => {
  if (v === null || v === '') return '';
  if (typeof v !== 'string') throw bad('team must be a team id or name, or null');
  return findTeam(data, v, () => bad(`unknown team: ${v}`)).id;
};

export function createMembers(data, input) {
  const f = body(input, ['email', 'emails', 'role', 'team']);
  const emails = f.emails ?? (f.email === undefined ? undefined : [f.email]);
  if (!Array.isArray(emails) || !emails.length) throw bad('send email (one address) or emails (a list)');
  for (const e of emails) if (typeof e !== 'string' || !EMAIL.test(e.trim())) throw bad(`${e} is not a valid email address`);
  const r = f.role === undefined ? 'Member' : role(f.role);
  const team = f.team === undefined ? '' : teamRef(data, f.team);
  return addMembers(
    data,
    emails.map(e => e.trim()),
    { role: r, team },
    newId,
  );
}

export function patchMember(data, ref, input) {
  const f = body(input, ['name', 'title', 'role', 'team']);
  if (!Object.keys(f).length) throw bad('no fields to update');
  const m = findMember(data, ref);
  const out = {};
  if ('name' in f) out.name = text(f.name, 'name');
  if ('title' in f) out.title = text(f.title, 'title', { required: false });
  if ('role' in f && f.role !== m.role) {
    if (m.role === 'Owner') throw bad('the owner keeps the Owner role');
    if (m.agent) throw bad('agents keep the Agent role');
    out.role = role(f.role);
  }
  if ('team' in f) out.team = teamRef(data, f.team);
  return Object.assign(m, out);
}

export function deleteMember(data, ref) {
  const m = findMember(data, ref);
  if (m.role === 'Owner' || m.id === data.me) throw new ApiError(409, `${m.name} is the workspace owner and cannot be removed`);
  removeMember(data, m);
  return m;
}

/* ---------- teams ---------- */

/* Reading never seeds: a workspace without teams shows the defaults the app would create on first use. */
export const listTeams = data => data.teams ?? TEAMS_SEED;

function findTeam(data, ref, missing = () => new ApiError(404, `no team ${ref}`)) {
  const r = String(ref).toLowerCase();
  const t = listTeams(data).find(t => t.id.toLowerCase() === r || t.name.toLowerCase() === r);
  if (!t) throw missing();
  return t;
}

function teamFields(data, f, self) {
  const out = {};
  if ('name' in f) {
    out.name = text(f.name, 'name');
    if (listTeams(data).some(t => t !== self && t.name.toLowerCase() === out.name.toLowerCase())) throw bad(`a team called ${out.name} already exists`);
  }
  if ('desc' in f) out.desc = text(f.desc, 'desc', { required: false });
  if ('icon' in f) {
    if (typeof f.icon !== 'string' || !ICON.test(f.icon)) throw bad('icon must be a Lucide icon name, like "users"');
    out.icon = f.icon;
  }
  if ('color' in f) {
    if (!Object.hasOwn(PCOLORS, f.color)) throw bad(`color must be one of: ${Object.keys(PCOLORS).join(', ')}`);
    out.c = PCOLORS[f.color];
  }
  if ('members' in f) {
    if (!Array.isArray(f.members)) throw bad('members must be a list of member ids');
    out.members = f.members.map(id => {
      const m = data.members.find(m => m.id === id);
      if (!m) throw bad(`unknown member: ${id}`);
      return m.id;
    });
  }
  return out;
}

export function createTeam(data, input) {
  const f = body(input, ['name', 'desc', 'icon', 'color', 'members']);
  if (f.name === undefined) throw bad('name is required');
  const { members, ...fields } = teamFields(data, { icon: 'users', color: 'teal', ...f });
  const t = addTeam(data, fields, newId);
  if (members) setTeamMembers(data, t, members);
  return t;
}

export function patchTeam(data, ref, input) {
  const f = body(input, ['name', 'desc', 'icon', 'color', 'members']);
  if (!Object.keys(f).length) throw bad('no fields to update');
  teamsOf(data); // editing a default team makes the defaults the workspace's own
  const t = findTeam(data, ref);
  const { members, ...fields } = teamFields(data, f, t);
  Object.assign(t, fields);
  if (members) setTeamMembers(data, t, members);
  return t;
}

export function deleteTeam(data, ref) {
  teamsOf(data);
  const t = findTeam(data, ref);
  removeTeam(data, t);
  return t;
}

/* ---------- milestones ---------- */

export const listMilestones = (data, key) => findProject(data, key).milestones || [];

const findMilestone = (p, name) => {
  const n = String(name).toLowerCase();
  const m = (p.milestones || []).find(m => m.name.toLowerCase() === n);
  if (!m) throw new ApiError(404, `no milestone ${name} on ${p.key}`);
  return m;
};
function milestoneFields(p, f, self) {
  const out = {};
  if ('name' in f) {
    out.name = text(f.name, 'name');
    if ((p.milestones || []).some(m => m !== self && m.name.toLowerCase() === out.name.toLowerCase()))
      throw bad(`${p.key} already has a milestone called ${out.name}`);
  }
  if ('date' in f) {
    if (!isDate(f.date)) throw bad('date must be YYYY-MM-DD');
    out.date = f.date;
  }
  return out;
}

export function addMilestone(data, key, input) {
  const f = body(input, ['name', 'date']);
  if (f.name === undefined || f.date === undefined) throw bad('name and date are required');
  const p = findProject(data, key);
  const m = milestoneFields(p, f);
  (p.milestones ??= []).push(m);
  return m;
}

export function patchMilestone(data, key, name, input) {
  const f = body(input, ['name', 'date']);
  if (!Object.keys(f).length) throw bad('no fields to update');
  const p = findProject(data, key);
  const m = findMilestone(p, name);
  return Object.assign(m, milestoneFields(p, f, m));
}

export function deleteMilestone(data, key, name) {
  const p = findProject(data, key);
  const m = findMilestone(p, name);
  p.milestones = p.milestones.filter(x => x !== m);
  return m;
}
