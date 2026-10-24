/* Edits to a project's milestones, shared by the project overview and the server's API so both enforce the same
   rules, like labels.js. A milestone is { name, date }: the name is unique within its project ignoring case, and is
   how it is found. Every function validates before it mutates. */
import { isDate } from './cycles.js';

export class MilestoneError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = msg => new MilestoneError(400, msg);
const MAX_NAME = 80;

const strictBody = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  return input;
};
const find = (p, name) => {
  const n = String(name).toLowerCase();
  const m = (p.milestones || []).find(m => m.name.toLowerCase() === n);
  if (!m) throw new MilestoneError(404, `no milestone ${name} on ${p.key}`);
  return m;
};
function clean(p, f, self) {
  const out = {};
  if ('name' in f) {
    if (typeof f.name !== 'string' || !f.name.trim()) throw bad('name must be a non-empty string');
    if (f.name.trim().length > MAX_NAME) throw bad(`name must be at most ${MAX_NAME} characters`);
    out.name = f.name.trim();
    if ((p.milestones || []).some(m => m !== self && m.name.toLowerCase() === out.name.toLowerCase()))
      throw bad(`${p.key} already has a milestone called ${out.name}`);
  }
  if ('date' in f) {
    if (!isDate(f.date)) throw bad('date must be YYYY-MM-DD');
    out.date = f.date;
  }
  return out;
}

export function addMilestone(p, input) {
  const f = strictBody(input, ['name', 'date']);
  if (f.name === undefined || f.date === undefined) throw bad('name and date are required');
  const m = clean(p, f);
  (p.milestones ??= []).push(m);
  return m;
}

export function changeMilestone(p, name, input) {
  const f = strictBody(input, ['name', 'date']);
  if (!Object.keys(f).length) throw bad('no fields to update');
  const m = find(p, name);
  return Object.assign(m, clean(p, f, m));
}

export function removeMilestone(p, name) {
  const m = find(p, name);
  p.milestones = p.milestones.filter(x => x !== m);
  return m;
}
