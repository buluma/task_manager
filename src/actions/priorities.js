/* =====================================================================
   ACTIONS · PRIORITIES: edit the priority scale from Settings
   ===================================================================== */
import { $ } from '../core/utils.js';
import { PR, applyPriorities } from '../core/constants.js';
import { ScaleError, addLevel, patchLevel, removeLevel } from '../core/priorities.js';
import { D } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { A, BLUR, IN, confirmDlg, restore, snapshot } from './actions.js';

/* Runs one scale change as a single saved mutation. A rule violation becomes a toast and the screen
   re-renders so inputs show the stored values again. */
function edit(change) {
  try {
    return mutate(() => {
      change();
      applyPriorities(D().priorities);
    });
  } catch (e) {
    if (!(e instanceof ScaleError)) throw e;
    toast(e.message, { kind: 'err' });
    render();
    return false;
  }
}

BLUR.prioName = el => {
  const name = el.value.trim();
  if (name === el.dataset.orig) return;
  if (edit(() => patchLevel(D(), el.dataset.id, { name }))) toast('Priority renamed', { ms: 1500 });
};
IN.prioWeight = el => {
  if (edit(() => patchLevel(D(), el.dataset.id, { w: +el.value }))) toast('Priority weight saved', { ms: 1500 });
};
A.addPriority = () => {
  const name = $('#prio-name').value.trim();
  if (edit(() => addLevel(D(), { name, w: +$('#prio-w').value }))) toast(`Added ${name}`);
  else $('#prio-name')?.focus();
};
A.delPriority = el => {
  const id = el.dataset.id;
  const p = PR[id];
  const n = D().tasks.filter(t => t.priority === id).length;
  confirmDlg({
    title: `Delete ${p.name}?`,
    body: n ? `<b>${n} task${n === 1 ? '' : 's'}</b> on this level will move to No priority.` : 'No tasks use this level.',
    ok: 'Delete level',
    icon: 'trash-2',
    danger: true,
    run: () => {
      const snap = snapshot();
      if (edit(() => removeLevel(D(), id, 'none', Date.now()))) toast(`Deleted ${p.name}`, { action: 'Undo', onAction: () => restore(snap) });
    },
  });
};
