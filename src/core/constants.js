/* ---------- vocab ---------- */
export const STATUSES = [
  { id: 'backlog', name: 'Backlog' },
  { id: 'todo', name: 'To Do' },
  { id: 'progress', name: 'In Progress' },
  { id: 'review', name: 'Review' },
  { id: 'done', name: 'Done' },
  { id: 'cancelled', name: 'Cancelled' },
];
export const ST = Object.fromEntries(STATUSES.map(s => [s.id, s]));
export const DEFAULT_PRIOS = [
  { id: 'urgent', name: 'Urgent', w: 4 },
  { id: 'high', name: 'High', w: 3 },
  { id: 'medium', name: 'Medium', w: 2 },
  { id: 'low', name: 'Low', w: 1 },
  { id: 'none', name: 'No priority', w: 0 },
];
/* The live scale. Both are filled in place by applyPriorities so every importer sees the current levels. */
export const PRIOS = DEFAULT_PRIOS.map(p => ({ ...p }));
export const PR = Object.fromEntries(PRIOS.map(p => [p.id, p]));
/* `list` is the workspace's own scale (data.priorities) or nothing for the defaults; "none" always exists. */
export function applyPriorities(list) {
  const levels = (list?.length ? list : DEFAULT_PRIOS).map(p => ({ id: p.id, name: p.name, w: p.w }));
  if (!levels.some(p => p.id === 'none')) levels.push({ id: 'none', name: 'No priority', w: 0 });
  levels.sort((a, b) => b.w - a.w);
  PRIOS.splice(0, PRIOS.length, ...levels);
  for (const k of Object.keys(PR)) delete PR[k];
  for (const p of PRIOS) PR[p.id] = p;
}
/* Bars drawn for a level: the levels between "none" and "urgent" spread over 1 to 3 bars, so a custom scale
   stays distinguishable. The default low/medium/high get 1/2/3. */
export function prBars(id) {
  const mid = PRIOS.filter(p => p.id !== 'none' && p.id !== 'urgent').sort((a, b) => a.w - b.w);
  const i = mid.findIndex(p => p.id === id);
  if (i < 0) return 3;
  return mid.length === 1 ? 2 : 1 + Math.round((i * 2) / (mid.length - 1));
}
export const LABELS = [
  { id: 'design', name: 'Design', c: 'var(--violet)' },
  { id: 'frontend', name: 'Frontend', c: 'var(--blue)' },
  { id: 'backend', name: 'Backend', c: 'var(--teal)' },
  { id: 'research', name: 'Research', c: 'var(--amber)' },
  { id: 'content', name: 'Content', c: 'var(--rose)' },
  { id: 'bug', name: 'Bug', c: 'var(--red)' },
  { id: 'qa', name: 'QA', c: 'var(--green)' },
  { id: 'growth', name: 'Growth', c: 'var(--orange)' },
];
export const LB = Object.fromEntries(LABELS.map(l => [l.id, l]));
export const PSTAT = {
  planning: { name: 'Planning', c: 'var(--gray)' },
  active: { name: 'In Progress', c: 'var(--blue)' },
  risk: { name: 'At Risk', c: 'var(--red)' },
  hold: { name: 'On Hold', c: 'var(--amber)' },
  complete: { name: 'Completed', c: 'var(--green)' },
};
export const PCOLORS = {
  indigo: '#5A67D8',
  blue: '#3B82C4',
  violet: '#8662C9',
  teal: '#23918A',
  rose: '#C54B78',
  amber: '#C48A1E',
  green: '#3D8E5F',
  slate: '#6B7280',
};
export const PICONS = [
  'globe',
  'smartphone',
  'megaphone',
  'rocket',
  'component',
  'building-2',
  'layout-grid',
  'palette',
  'code',
  'briefcase',
  'target',
  'layers',
  'zap',
  'heart',
  'folder',
  'sparkles',
];
export const ROLES = ['Owner', 'Admin', 'Member', 'Guest'];
export const TEAMS_SEED = [
  { id: 'design', name: 'Design', icon: 'palette', c: '#8662C9', desc: 'Product design, brand, and research' },
  { id: 'eng', name: 'Engineering', icon: 'code', c: '#3B82C4', desc: 'Web, mobile, and platform engineering' },
  { id: 'mkt', name: 'Marketing', icon: 'megaphone', c: '#C54B78', desc: 'Campaigns, content, and growth' },
  { id: 'product', name: 'Product', icon: 'target', c: '#C48A1E', desc: 'Roadmap, planning, and QA' },
];
