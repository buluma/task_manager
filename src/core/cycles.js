/* ---------- cycles: weekly, implicit, unfinished work rolls forward ----------
   A cycle is a calendar week named by the iso date of its first day. Tasks join one by setting
   `task.cycle`. Pure date-string math (UTC) so DST never shifts a boundary; no DOM, no store. */
const DAY = 864e5;
const toMs = s => Date.UTC(...s.split('-').map((n, i) => (i === 1 ? n - 1 : +n)));
const toIso = ms => new Date(ms).toISOString().slice(0, 10);

/* weekStart: 0 = Sunday … 6 = Saturday, same as the weekStart preference. */
export function cycleStart(date, weekStart) {
  const ms = toMs(date);
  const back = (new Date(ms).getUTCDay() - weekStart + 7) % 7;
  return toIso(ms - back * DAY);
}
export const cycleEnd = start => toIso(toMs(start) + 6 * DAY);

/* Moves every unfinished task from an earlier cycle into `current`, remembering where it has been.
   Done tasks stay in the cycle they were finished in. Returns how many moved. */
export function rollCycles(tasks, current) {
  let moved = 0;
  for (const t of tasks) {
    if (!t.cycle || t.cycle >= current || t.status === 'done' || t.archived) continue;
    (t.past ||= []).push(t.cycle);
    t.carried = (t.carried || 0) + 1;
    t.cycle = current;
    moved++;
  }
  return moved;
}

const planned = (t, id) => t.cycle === id || (t.past || []).includes(id);
export function cycleStats(tasks, id) {
  const inCycle = tasks.filter(t => planned(t, id) && !t.archived);
  return {
    total: inCycle.length,
    done: inCycle.filter(t => t.cycle === id && t.status === 'done').length,
    carried: inCycle.filter(t => t.cycle !== id).length,
  };
}

export function pastCycles(tasks, current) {
  const ids = new Set(tasks.flatMap(t => [t.cycle, ...(t.past || [])]).filter(Boolean));
  return [...ids]
    .filter(id => id < current)
    .sort()
    .reverse();
}
