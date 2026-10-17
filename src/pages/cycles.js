/* ---------- CYCLES ---------- */
import { esc, fmtDate } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { D, allTasks, currentCycle } from '../core/store.js';
import { cycleEnd, cycleStats, pastCycles } from '../core/cycles.js';
import { applyView, viewOf, viewToolbar } from '../shell/view-engine.js';
import { listHtml } from '../components/task-list.js';

const range = id => `${fmtDate(id)} – ${fmtDate(cycleEnd(id))}`;

function pastRow(tasks, id) {
  const { total, done, carried } = cycleStats(tasks, id);
  return `<div class="row" style="gap:12px;padding:8px var(--gutter);border-bottom:1px solid var(--divider);font-size:13px">
    <span class="grow">${esc(range(id))}</span>
    <span class="prog green" style="max-width:120px;flex:none;width:120px"><i style="--p:${total ? done / total : 0}"></i></span>
    <span class="num muted" style="width:90px;text-align:right">${done}/${total} done</span>
    <span class="num faint" style="width:90px;text-align:right">${carried ? `${carried} carried` : ''}</span>
  </div>`;
}

export function pageCycles() {
  const key = 'cycles';
  const cur = currentCycle();
  const v = viewOf(key);
  const tasks = allTasks();
  const open = t => t.status !== 'done';
  const inCycle = applyView(
    tasks.filter(t => t.cycle === cur && open(t)),
    v,
  );
  const done = applyView(
    tasks.filter(t => t.cycle === cur && !open(t)),
    v,
  );
  const backlog = applyView(
    tasks.filter(t => !t.cycle && open(t)),
    v,
  );
  const { total, done: nDone, carried } = cycleStats(tasks, cur);
  const past = pastCycles(tasks, cur).slice(0, 8);
  const me = D().me;
  const groups = [
    { key: 'cycle', name: 'This cycle', html: ic('refresh-cw', 14), tasks: inCycle, set: { cycle: cur, assignee: me } },
    {
      key: 'done',
      name: 'Done',
      html: `<span style="color:var(--green)">${ic('circle-check', 14)}</span>`,
      tasks: done,
      set: { cycle: cur, status: 'done', assignee: me },
      collapsed: true,
    },
    { key: 'backlog', name: 'Backlog', html: ic('inbox', 14), tasks: backlog, set: { status: 'backlog', assignee: me } },
  ];
  return `<div class="page flush">
    <div class="ph"><div><h1>Cycle · ${esc(range(cur))}</h1>
      <p>${nDone} of ${total} done${carried ? ` · ${carried} carried over from earlier` : ''}. Unfinished work rolls into the next cycle automatically.</p></div>
      <div class="acts"><button class="btn btn-secondary" data-a="quickAdd">${ic('zap', 14)}Quick add</button><button class="btn btn-primary" data-a="newTask" data-assignee="${me}">${ic('plus', 14)}New task</button></div></div>
    <div style="padding:0 var(--gutter) 12px"><div class="prog green"><i style="--p:${total ? nDone / total : 0}"></i></div></div>
    ${viewToolbar(key, { group: false })}
    <div class="list-wrap">${listHtml(groups, key, { cols: ['status', 'priority', 'due', 'cycle'], complete: true, drag: false, keepEmpty: true })}</div>
    ${past.length ? `<div class="eyebrow" style="padding:20px var(--gutter) 6px">Previous cycles</div>${past.map(id => pastRow(tasks, id)).join('')}` : ''}
  </div>`;
}
