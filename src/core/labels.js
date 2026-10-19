/* Edits to the workspace's labels, shared by the settings screen and the server's API so both enforce the same
   rules, like priorities.js. A task stores label ids. The list is workspace state (data.labels): until someone
   edits it the state has no such field and the built-in labels apply. Labels typed straight onto tasks (the API,
   the CLI, imports) are labels too: they show in the list, gray, and the first edit makes them the workspace's own.
   Ids never change, so tasks keep pointing at a renamed label; a new label's id is the name it was given. Every
   function validates before it mutates. */
import { DEFAULT_LABELS, LABEL_COLORS, applyLabels, sameLabel } from './constants.js';

export class LabelError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
const bad = msg => new LabelError(400, msg);
const MAX_NAME = 40;

const strictBody = (input, allowed) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('body must be a JSON object');
  for (const k of Object.keys(input)) if (!allowed.includes(k)) throw bad(`unknown field: ${k}`);
  return input;
};
const cleanName = name => {
  if (typeof name !== 'string' || !name.trim()) throw bad('name must be a non-empty string');
  if (name.trim().length > MAX_NAME) throw bad(`name must be at most ${MAX_NAME} characters`);
  return name.trim();
};
const cleanColor = color => {
  if (!LABEL_COLORS.includes(color)) throw bad(`color must be one of: ${LABEL_COLORS.join(', ')}`);
  return color;
};

/* Every label: the workspace's list (or the built-in one), then each other label in use on a task, once, by name. */
export function labelList(data) {
  const list = (data.labels ?? DEFAULT_LABELS).map(l => ({ id: l.id, name: l.name, color: l.color }));
  const extra = [];
  for (const t of data.tasks)
    for (const id of t.labels || []) if (![...list, ...extra].some(l => sameLabel(l.id, id))) extra.push({ id, name: String(id), color: 'gray' });
  extra.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return [...list, ...extra];
}

/* Copies the full list into the state so it can be edited. */
const own = data => (data.labels = labelList(data));
const find = (data, id) => {
  const l = labelList(data).find(l => sameLabel(l.id, id));
  if (!l) throw new LabelError(404, `no label ${id}`);
  return l;
};
/* A name may not match another label's name or id, so a label can always be found by what it is called. */
const unique = (data, name, self) => {
  if (labelList(data).some(l => !(self && sameLabel(l.id, self)) && (sameLabel(l.name, name) || sameLabel(l.id, name))))
    throw bad(`a label called ${name} already exists`);
};

export function addLabel(data, input) {
  const f = strictBody(input, ['name', 'color']);
  const name = cleanName(f.name);
  const color = f.color === undefined ? 'gray' : cleanColor(f.color);
  unique(data, name);
  const label = { id: name, name, color };
  own(data).push(label);
  return { ...label };
}

export function patchLabel(data, id, input) {
  const f = strictBody(input, ['name', 'color']);
  const { id: key } = find(data, id);
  if (!Object.keys(f).length) throw bad('no fields to update');
  const name = 'name' in f ? cleanName(f.name) : undefined;
  const color = 'color' in f ? cleanColor(f.color) : undefined;
  if (name !== undefined) unique(data, name, key);
  const label = own(data).find(l => l.id === key);
  if (name !== undefined) label.name = name;
  if (color !== undefined) label.color = color;
  return { ...label };
}

/* Saved views keep label ids in their filters: drop the removed one, and any filter left with none. */
function pruneViewFilters(data, id) {
  for (const view of data.savedViews || []) {
    if (!view.filters) continue;
    view.filters = view.filters
      .map(f => (f.f === 'labels' && Array.isArray(f.v) ? { ...f, v: f.v.filter(v => !sameLabel(v, id)) } : f))
      .filter(f => !(f.f === 'labels' && Array.isArray(f.v) && f.v.length === 0));
  }
}

/* The label goes from the list and from every task (archived ones too) in any spelling. Returns how many tasks
   had it. */
export function removeLabel(data, id, now) {
  const { id: key } = find(data, id);
  data.labels = own(data).filter(l => l.id !== key);
  let n = 0;
  for (const t of data.tasks) {
    if (!(t.labels || []).some(l => sameLabel(l, key))) continue;
    t.labels = t.labels.filter(l => !sameLabel(l, key));
    t.updated = now;
    n++;
  }
  pruneViewFilters(data, key);
  return n;
}

/* The one call to make whenever workspace state is loaded or replaced, alongside adoptPriorities. */
export const adoptLabels = data => applyLabels(data.labels);
