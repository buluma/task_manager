/* ---------- drag to reorder: the order a drop leaves behind ---------- */

/* Whether the view draws tasks in their stored order, the only sort a dragged order holds under. */
export const isManual = v => v.sort.f === 'manual' && (v.sort.dir || 1) === 1;

/* Put the view's sort on Manual, ascending. True when it had to change. */
export function forceManual(v) {
  if (isManual(v)) return false;
  v.sort = { f: 'manual', dir: 1 };
  return true;
}

/* `shown` is a board column's task ids top to bottom as drawn, `id` the dropped card (in `shown` when it came
   from this column) and `before` the card it lands above (null: at the bottom). Returns { id: order } that draws
   the column in its new sequence under Manual, or null when the drop leaves the sequence as it was. The cards
   trade the order values they already hold, so cards a filter hides keep their place among them. */
export function columnOrders(shown, id, before, orderOf) {
  const next = shown.filter(x => x !== id);
  const at = before == null ? -1 : next.indexOf(before);
  next.splice(at < 0 ? next.length : at, 0, id);
  if (next.length === shown.length && next.every((x, i) => x === shown[i])) return null;
  const slots = next.map(x => orderOf(x) ?? 0).sort((a, b) => a - b);
  // tied values would leave the sequence to chance: lift each tie between its neighbours
  for (let i = 1; i < slots.length; i++) {
    if (slots[i] > slots[i - 1]) continue;
    const up = slots.slice(i + 1).find(x => x > slots[i - 1]);
    slots[i] = up === undefined ? slots[i - 1] + 1 : (slots[i - 1] + up) / 2;
  }
  return Object.fromEntries(next.map((x, i) => [x, slots[i]]));
}
