/* =====================================================================
   ACTIONS · LABELS: edit the workspace's labels from Settings
   ===================================================================== */
import { $ } from '../core/utils.js';
import { labelOf } from '../core/constants.js';
import { LabelError, addLabel, adoptLabels, patchLabel, removeLabel } from '../core/labels.js';
import { D } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { render } from '../shell/render.js';
import { A, BLUR, IN, confirmDlg, restore, snapshot } from './actions.js';

/* Runs one label change as a single saved mutation, like the priority scale. A rule violation becomes a toast and
   the screen re-renders so inputs show the stored values again. */
function edit(change) {
  try {
    return mutate(() => {
      change();
      adoptLabels(D());
    });
  } catch (e) {
    if (!(e instanceof LabelError)) throw e;
    toast(e.message, { kind: 'err' });
    render();
    return false;
  }
}

BLUR.labelName = el => {
  const name = el.value.trim();
  if (name === el.dataset.orig) return;
  if (edit(() => patchLabel(D(), el.dataset.id, { name }))) toast('Label renamed', { ms: 1500 });
};
IN.labelColor = el => {
  if (edit(() => patchLabel(D(), el.dataset.id, { color: el.value }))) toast('Label colour saved', { ms: 1500 });
};
A.addLabel = () => {
  const name = $('#label-name').value.trim();
  if (edit(() => addLabel(D(), { name, color: $('#label-color').value }))) toast(`Added ${name}`);
  else $('#label-name')?.focus();
};
A.delLabel = el => {
  const id = el.dataset.id;
  const name = labelOf(id).name;
  const n = D().tasks.filter(t => (t.labels || []).some(l => l.toLowerCase() === id.toLowerCase())).length;
  confirmDlg({
    title: `Delete ${name}?`,
    body: n ? `It comes off <b>${n} task${n === 1 ? '' : 's'}</b>. The tasks are kept.` : 'No tasks use this label.',
    ok: 'Delete label',
    icon: 'trash-2',
    danger: true,
    run: () => {
      const snap = snapshot();
      if (edit(() => removeLabel(D(), id, Date.now()))) toast(`Deleted ${name}`, { action: 'Undo', onAction: () => restore(snap) });
    },
  });
};
