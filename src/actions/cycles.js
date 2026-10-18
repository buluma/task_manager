/* =====================================================================
   ACTIONS · CYCLES: weekly roll-over, add/remove from the current cycle, quick add
   ===================================================================== */
import { $ } from '../core/utils.js';
import { D, S, currentCycle, save, task } from '../core/store.js';
import { rollCycles } from '../core/cycles.js';
import { mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { openModal } from '../overlays/modals.js';
import { A, createTask, updateTask } from './actions.js';

/* Moves unfinished tasks from past cycles into the current one. True when anything moved. */
export function rollNow() {
  if (!rollCycles(D().tasks, currentCycle())) return false;
  save();
  return true;
}

A.toggleCycle = el => {
  const t = task(el.dataset.id);
  if (!t) return;
  const cur = currentCycle();
  updateTask(t.id, { cycle: t.cycle === cur ? null : cur });
};

A.quickAdd = () => {
  openModal({ type: 'quick' });
};
A.quickSubmit = () => {
  const title = $('#quick-in')?.value.trim();
  if (!title) {
    $('#quick-in')?.focus();
    return;
  }
  S.ui.modals.pop();
  let t;
  mutate(() => {
    t = createTask({ title, status: 'backlog', assignee: D().me, project: S.ui.route === 'project' ? S.ui.params.id : undefined });
  });
  render();
  if (t) toast(`Added ${t.key} to the backlog`, { ms: 2000 });
};
