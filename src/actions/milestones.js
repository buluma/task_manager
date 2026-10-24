/* =====================================================================
   ACTIONS · MILESTONES: add, edit and delete a project's milestones from its overview
   ===================================================================== */
import { $ } from '../core/utils.js';
import { MilestoneError, addMilestone, changeMilestone, removeMilestone } from '../core/milestones.js';
import { S, proj } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { openModal } from '../overlays/modals.js';
import { A, restore, snapshot } from './actions.js';

const top = () => S.ui.modals[S.ui.modals.length - 1];

/* Runs one milestone change as a single saved mutation, closing the dialog. A rule violation becomes a toast and
   the dialog stays open with what was typed. */
function edit(change) {
  const m = top();
  try {
    const p = proj(m.project);
    change(p); // throws before anything is saved
    S.ui.modals.pop();
    mutate(() => {});
    return true;
  } catch (e) {
    if (!(e instanceof MilestoneError)) throw e;
    toast(e.message, { kind: 'err' });
    $('#ms-name')?.focus();
    return false;
  }
}

A.newMilestone = el => openModal({ type: 'milestone', project: el.dataset.id });
A.editMilestone = el => openModal({ type: 'milestone', project: el.dataset.id, name: el.dataset.name });
A.milestoneSubmit = () => {
  const m = top();
  const f = { name: $('#ms-name').value, date: $('#ms-date').value };
  const done = edit(p => (m.name ? changeMilestone(p, m.name, f) : addMilestone(p, f)));
  if (done) toast(m.name ? 'Milestone saved' : `Added ${f.name.trim()}`, { ms: 1800 });
};
A.delMilestone = () => {
  const m = top();
  const snap = snapshot();
  if (edit(p => removeMilestone(p, m.name))) toast(`Deleted ${m.name}`, { action: 'Undo', onAction: () => restore(snap) });
};
