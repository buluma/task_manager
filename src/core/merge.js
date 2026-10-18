/* ---------- three-way merge of the workspace ----------
   When this tab's save loses the race (409), sync.js merges what the tab had last synced (base), what it
   tried to save (mine) and what the server has now (theirs), then saves the result. Lists of records with
   an id (tasks, comments, activity, ...) merge record by record, objects key by key. Where both sides
   changed the same value, theirs is kept and the path is reported. */

const isObj = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const clone = v => (v === undefined ? v : structuredClone(v));
const byId = a => Array.isArray(a) && a.every(x => isObj(x) && 'id' in x) && new Set(a.map(x => x.id)).size === a.length;

function eq(a, b) {
  if (a === b) return true;
  if (Array.isArray(a)) return Array.isArray(b) && a.length === b.length && a.every((x, i) => eq(x, b[i]));
  if (!isObj(a) || !isObj(b)) return false;
  const ka = Object.keys(a);
  return ka.length === Object.keys(b).length && ka.every(k => Object.hasOwn(b, k) && eq(a[k], b[k]));
}

function merge3(base, mine, theirs, path, conflicts) {
  if (eq(mine, theirs) || eq(mine, base)) return clone(theirs);
  if (eq(theirs, base)) return clone(mine);
  if (byId(mine) && byId(theirs) && (base === undefined || byId(base))) return mergeList(base || [], mine, theirs, path, conflicts);
  if (isObj(mine) && isObj(theirs) && (base === undefined || isObj(base))) {
    const b = base || {};
    const out = {};
    for (const k of new Set([...Object.keys(theirs), ...Object.keys(mine)])) {
      const v = merge3(b[k], mine[k], theirs[k], [...path, k], conflicts);
      if (v !== undefined) out[k] = v;
    }
    return out;
  }
  conflicts.push(path);
  return clone(theirs);
}

/* Theirs' order is kept. A record only I added goes right after the record before it in my list (past any
   that only they added), or first if it was first: so appended lists stay appended, newest-first lists stay
   newest-first. A delete wins over an untouched record; an edit wins over a delete, and is reported. */
function mergeList(base, mine, theirs, path, conflicts) {
  const B = new Map(base.map(x => [x.id, x]));
  const M = new Map(mine.map(x => [x.id, x]));
  const T = new Set(theirs.map(x => x.id));
  const out = [];
  for (const t of theirs) {
    const b = B.get(t.id);
    if (M.has(t.id)) out.push(merge3(b, M.get(t.id), t, [...path, t.id], conflicts));
    else if (!b) out.push(clone(t));
    else if (!eq(t, b)) {
      conflicts.push([...path, t.id]);
      out.push(clone(t));
    }
  }
  mine.forEach((m, i) => {
    if (T.has(m.id)) return;
    const b = B.get(m.id);
    if (b && eq(m, b)) return;
    if (b) conflicts.push([...path, m.id]);
    let at = 0;
    for (let j = i - 1; j >= 0; j--) {
      const k = out.findIndex(x => x.id === mine[j].id);
      if (k < 0) continue;
      at = k + 1;
      while (at < out.length && !M.has(out[at].id)) at++;
      break;
    }
    out.splice(at, 0, clone(m));
  });
  return out;
}

/* Task keys come from project.seq, so both sides may have handed out the same key. Theirs keep theirs;
   mine get the next free number. A seq both sides bumped is settled here, so it is not a conflict. */
function rekey(data, mine, theirs, conflicts) {
  if (!Array.isArray(data?.tasks) || !Array.isArray(data.projects)) return conflicts;
  for (const p of data.projects) {
    const seqs = [mine?.projects, theirs?.projects].map(ps => ps?.find?.(x => x.id === p.id)?.seq).filter(Number.isFinite);
    if (seqs.length) p.seq = Math.max(p.seq ?? 0, ...seqs);
  }
  const theirIds = new Set((theirs?.tasks || []).map(t => t.id));
  const taken = new Set(data.tasks.filter(t => theirIds.has(t.id)).map(t => t.key));
  for (const t of data.tasks) {
    if (theirIds.has(t.id)) continue;
    const p = data.projects.find(x => x.id === t.project);
    if (taken.has(t.key) && p) {
      const used = data.tasks.filter(x => x.project === p.id).map(x => Number(String(x.key).split('-').pop()) || 0);
      p.seq = Math.max(p.seq ?? 200, ...used) + 1;
      t.key = `${p.key}-${p.seq}`;
    }
    taken.add(t.key);
  }
  return conflicts.filter(c => !(c[0] === 'data' && c[1] === 'projects' && c[3] === 'seq' && c.length === 4));
}

export function mergeState(base, mine, theirs) {
  const conflicts = [];
  const state = merge3(base, mine, theirs, [], conflicts);
  return { state, conflicts: rekey(state?.data, mine?.data, theirs?.data, conflicts) };
}
