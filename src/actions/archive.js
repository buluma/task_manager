/* =====================================================================
   ACTIONS · ARCHIVE: restore and purge
   ===================================================================== */
import { esc } from '../core/utils.js';
import { restoreTask } from '../core/archive.js';
import { D, task } from '../core/store.js';
import { mutate, toast } from '../ui/toast.js';
import { A, asMe, confirmDlg, deleteTasks } from './actions.js';

A.restoreTask = el => {
  const t = task(el.dataset.id);
  if (mutate(() => restoreTask(D(), t, asMe()))) toast(`Restored “${t.title}”`, { action: 'Open', onAction: () => A.openTask({ dataset: { id: t.id } }) });
};
A.purgeTask = el => {
  const t = task(el.dataset.id);
  confirmDlg({
    title: 'Delete task permanently?',
    body: `<b>${esc(t.title)}</b>, its subtasks and comments will be deleted for everyone. This can't be undone.`,
    ok: 'Delete permanently',
    danger: true,
    run: () => {
      if (mutate(() => deleteTasks([t.id]))) toast(`Deleted “${t.title}”`);
    },
  });
};
