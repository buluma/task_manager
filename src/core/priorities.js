/* Edits to the priority scale, shared by the sync server's API and the settings screen so both
   enforce the same rules. The scale is workspace state (data.priorities). Until someone edits it the
   state has no such field and the defaults apply. Every function validates before it mutates. */
import { DEFAULT_PRIOS } from './constants.js';

export class ScaleError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = msg => new ScaleError(400, msg);

const SLUG = /^[a-z][a-z0-9-]{0,23}$/;
export const MAX_WEIGHT = 99;

export const scaleOf = data => (data.priorities?.length ? data.priorities : DEFAULT_PRIOS);

const validWeight = w => Number.isInteger(w) && w >= 1 && w <= MAX_WEIGHT;
/* Copies the effective scale into the state so it can be edited. */
const own = data => (data.priorities = scaleOf(data).map(p => ({ id: p.id, name: p.name, w: p.w })));
const find = (data, id) => {
  const p = scaleOf(data).find(p => p.id === id);
  if (!p) throw new ScaleError(404, `no priority ${id}`);
  return p;
};
const strictBody = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  return input;
};
const cleanName = name => {
  if (typeof name !== 'string' || !name.trim()) throw bad('name must be a non-empty string');
  return name.trim();
};

export function addLevel(data, input) {
  const { id, name, w } = strictBody(input, ['id', 'name', 'w']);
  const clean = cleanName(name);
  if (!validWeight(w)) throw bad(`w must be a whole number from 1 to ${MAX_WEIGHT} (0 is reserved for "none")`);
  const slug =
    id ??
    clean
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24);
  if (typeof slug !== 'string' || !SLUG.test(slug))
    throw bad(id === undefined ? 'name must start with a letter' : 'id must start with a letter and use only a-z, 0-9 and "-" (max 24)');
  if (scaleOf(data).some(p => p.id === slug)) throw bad(`priority ${slug} already exists`);
  const level = { id: slug, name: clean, w };
  own(data).push(level);
  return level;
}

export function patchLevel(data, id, input) {
  const f = strictBody(input, ['name', 'w']);
  find(data, id);
  if (!Object.keys(f).length) throw bad('no fields to update');
  const name = 'name' in f ? cleanName(f.name) : undefined;
  if ('w' in f) {
    if (id === 'none') throw bad('the "none" priority always has weight 0');
    if (!validWeight(f.w)) throw bad(`w must be a whole number from 1 to ${MAX_WEIGHT}`);
  }
  const level = own(data).find(p => p.id === id);
  if (name !== undefined) level.name = name;
  if ('w' in f) level.w = f.w;
  return { ...level };
}

/* Tasks (archived ones too) on the removed level move to `replace`. Returns how many moved. */
export function removeLevel(data, id, replace = 'none', now) {
  find(data, id);
  if (id === 'none') throw bad('the "none" priority cannot be deleted');
  if (replace === id) throw bad('replace must be a different priority');
  if (!scaleOf(data).some(p => p.id === replace)) throw bad(`unknown replacement priority: ${replace}`);
  data.priorities = own(data).filter(p => p.id !== id);
  let moved = 0;
  for (const t of data.tasks)
    if (t.priority === id) {
      t.priority = replace;
      t.updated = now;
      moved++;
    }
  return moved;
}
