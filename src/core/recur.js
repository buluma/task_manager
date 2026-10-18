/* ---------- repeating tasks ----------
   Shared by the app (actions.js) and the server (server/tasks.js), so both schedule the next occurrence alike. */

/* Days between occurrences; the key order is the order the repeat popover lists them in. */
export const RECUR_DAYS = { Daily: 1, Weekly: 7, 'Every 2 weeks': 14, Monthly: 30 };

/* The due date of the occurrence after one due on `due` (YYYY-MM-DD). Calendar arithmetic in UTC, so the
   result doesn't depend on the machine's timezone or a DST change. */
export function nextDue(due, recur) {
  const [y, m, d] = due.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + (RECUR_DAYS[recur] || 7))).toISOString().slice(0, 10);
}
