/* The board's and list's drag and drop handlers (src/actions/drag-drop.js), driven through the document listeners they
   register, on a fake page (fake-dom.js) laid out like the markup board.js and task-list.js draw. */
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { listeners, page, S, emptyWorkspace } from './app-harness.js';
import { El } from './fake-dom.js';
import { TEAMS_SEED } from '../src/core/constants.js';

const KEY = 'p:p1';
const t = (id, status, order, created) => ({ id, key: id.toUpperCase(), project: 'p1', title: id, status, order, created, subtasks: [], deps: [], labels: [] });

beforeEach(() => {
  S.data = {
    ...emptyWorkspace(),
    teams: TEAMS_SEED.map(x => ({ ...x })),
    // created newest first draws A1 A2 A3 in backlog and B1 B2 in todo; their stored order says otherwise
    tasks: [t('a1', 'backlog', 3, 30), t('a2', 'backlog', 1, 20), t('a3', 'backlog', 2, 10), t('b1', 'todo', 2, 50), t('b2', 'todo', 1, 40)],
  };
  S.views = { [KEY]: { filters: [], sort: { f: 'created', dir: 1 }, group: 'status', q: '', hidden: [], colW: {}, showDone: true } };
  S.ui.collapsedCols = {};
});

const order = id => S.data.tasks.find(x => x.id === id).order;
const status = id => S.data.tasks.find(x => x.id === id).status;
const byOrder = ids => [...ids].sort((a, b) => order(a) - order(b));
const fire = (type, e) => listeners[type].forEach(fn => fn({ preventDefault() {}, dataTransfer: { setData() {}, setDragImage() {} }, ...e }));

/* A board with a column per [status, ids] (ids null: collapsed), cards 100px apart from the top. */
function board(cols) {
  const els = {};
  const root = new El('board', { keep: `board:${KEY}` });
  for (const [st, ids] of cols) {
    const col = new El(`bcol${ids ? '' : ' collapsed'}`, { dropCol: st, key: KEY });
    if (ids) {
      const body = new El('bcol-b', { colBody: st });
      ids.forEach((id, i) => {
        const card = new El('kcard', { dragCard: id });
        card.rect = { top: i * 100, height: 80 };
        body.append((els[id] = card));
      });
      col.append(body.append(new El('addcard')));
    }
    root.append((els[st] = col));
  }
  page.root = root;
  return els;
}

/* The browser marks the dragged card a tick after dragstart (drag-drop.js), and only then stops aiming at it. */
const tick = () => new Promise(r => setTimeout(r, 0));

/* Drags card `id` over `target` at height `y`, then drops it there. */
async function dragCard(els, id, target, y) {
  fire('dragstart', { target: els[id] });
  await tick();
  fire('dragover', { target, clientY: y });
  fire('drop', { target });
}

test('reordering inside a column switches the board to Manual and keeps every open column as drawn', async () => {
  const els = board([
    ['backlog', ['a1', 'a2', 'a3']],
    ['todo', ['b1', 'b2']],
  ]);
  await dragCard(els, 'a3', els.a1, 10); // above A1
  assert.deepEqual(S.views[KEY].sort, { f: 'manual', dir: 1 });
  assert.deepEqual(byOrder(['a1', 'a2', 'a3']), ['a3', 'a1', 'a2']);
  assert.deepEqual(byOrder(['b1', 'b2']), ['b1', 'b2'], 'the column not touched does not jump to its stored order');
});

test('a drop that leaves the column as it was changes nothing, sort included', async () => {
  const els = board([['backlog', ['a1', 'a2', 'a3']]]);
  const before = S.data.tasks.map(x => x.order);
  await dragCard(els, 'a1', els.a2, 120); // above A2, where it already is
  assert.deepEqual(
    S.data.tasks.map(x => x.order),
    before,
  );
  assert.deepEqual(S.views[KEY].sort, { f: 'created', dir: 1 });
});

test('dropping on another column moves the task there and leaves the sort alone', async () => {
  const els = board([
    ['backlog', ['a1', 'a2', 'a3']],
    ['todo', ['b1', 'b2']],
  ]);
  await dragCard(els, 'a2', els.b2, 500); // below every card in To Do
  assert.equal(status('a2'), 'todo');
  assert.deepEqual(S.views[KEY].sort, { f: 'created', dir: 1 });
  assert.ok(order('a2') > Math.max(order('b1'), order('b2')), 'it goes to the bottom');
});

test('dropping on a collapsed column moves the task into it, not into the column dragged over before', async () => {
  const els = board([
    ['backlog', ['a1', 'a2', 'a3']],
    ['todo', null],
  ]);
  fire('dragstart', { target: els.a1 });
  await tick();
  fire('dragover', { target: els.a2, clientY: 150 });
  fire('dragover', { target: els.todo, clientY: 0 });
  fire('drop', { target: els.todo });
  assert.equal(status('a1'), 'todo');
});

test('dropping a list row reorders the list as drawn, takes the group it lands in, and switches to Manual', async () => {
  const row = (id, group) => new El('trow', { taskRow: id, group, lkey: KEY }, [new El('handle', { dragRow: id })]);
  const rows = { a1: row('a1', 'backlog'), a2: row('a2', 'backlog'), b1: row('b1', 'todo'), b2: row('b2', 'todo') };
  rows.b2.rect = { top: 300, height: 40 };
  page.root = new El('tlist', {}, Object.values(rows));
  fire('dragstart', { target: rows.a1.children[0] });
  await tick();
  fire('dragover', { target: rows.b2, clientY: 310 }); // top half: before B2
  fire('drop', { target: rows.b2 });
  assert.equal(status('a1'), 'todo');
  assert.deepEqual(byOrder(['a1', 'a2', 'b1', 'b2']), ['a2', 'b1', 'a1', 'b2']);
  assert.deepEqual(S.views[KEY].sort, { f: 'manual', dir: 1 });
});
