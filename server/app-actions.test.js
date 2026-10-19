/* Tests of the browser app's own action handlers, loaded by app-harness.js. UI modules have no tests of their own,
   so the wiring between the markup and the action tables is checked here. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { app, S, emptyWorkspace } from './app-harness.js';
import { TEAMS_SEED } from '../src/core/constants.js';

const SRC = new URL('../src/', import.meta.url).pathname;
const sources = dir =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return sources(p);
    return e.name.endsWith('.js') && !e.name.endsWith('.test.js') ? [p] : [];
  });

/* Every handler name the markup can dispatch, and the table it is looked up in (events.js, keyboard.js). Names built
   at runtime (data-a="${act}") are not literal here; their literal sources, I('…') and act: '…', are. */
const WIRING = [
  [/data-a="([A-Za-z]+)"/g, 'A'],
  [/\bI\('([A-Za-z]+)'/g, 'A'],
  [/\bact: '([A-Za-z]+)'/g, 'A'],
  [/data-in="([A-Za-z]+)"/g, 'IN'],
  [/data-blur="([A-Za-z]+)"/g, 'BLUR'],
  [/data-dbl="([A-Za-z]+)"/g, 'DBL'],
  [/data-key-(?:mod-)?enter="([A-Za-z]+)"/g, 'KEY'],
];

test('every action the markup names has a handler in its action table', () => {
  const missing = [];
  let seen = 0;
  for (const file of sources(SRC)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const [re, table] of WIRING)
      for (const [, name] of text.matchAll(re)) {
        seen++;
        if (typeof app[table][name] !== 'function') missing.push(`${table}.${name} (${path.relative(SRC, file)})`);
      }
  }
  assert.ok(seen > 300, `only ${seen} action names found: the patterns no longer match the markup`);
  assert.deepEqual([...new Set(missing)], []);
});

test('archiving a board column archives and logs each of its tasks, as archiving one task does', () => {
  const t = (id, status) => ({ id, key: id.toUpperCase(), project: 'p1', title: id, status, subtasks: [], deps: [], labels: [], order: 1 });
  S.data = { ...emptyWorkspace(), teams: TEAMS_SEED.map(x => ({ ...x })), tasks: [t('t1', 'done'), t('t2', 'done'), t('t3', 'todo')] };
  S.ui.pop = { key: 'p:p1' };
  app.A.colArchive({ dataset: { id: 'done' } });
  assert.deepEqual(
    S.data.tasks.map(x => [x.id, !!x.archived]),
    [
      ['t1', true],
      ['t2', true],
      ['t3', false],
    ],
  );
  assert.deepEqual(S.data.activity.map(a => [a.verb, a.task]).sort(), [
    ['archived', 't1'],
    ['archived', 't2'],
  ]);
});

test('Copy link copies a link to this server that opens the task or project', async () => {
  let copied;
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async s => (copied = s) }, configurable: true });
  globalThis.location = { origin: 'http://gr8r.example:8787', pathname: '/' };
  const p = { ...emptyWorkspace().projects[0] };
  S.data = {
    ...emptyWorkspace(),
    teams: TEAMS_SEED.map(x => ({ ...x })),
    projects: [p],
    tasks: [{ id: 't1', key: 'GR-12', project: p.id, title: 'x', status: 'todo', subtasks: [], deps: [], labels: [], order: 1 }],
  };
  const linkOf = async dataset => {
    app.A.copyLink({ dataset });
    await new Promise(r => setImmediate(r));
    return copied;
  };
  assert.equal(await linkOf({ id: 't1' }), 'http://gr8r.example:8787/#task/GR-12');
  assert.equal(await linkOf({ pid: p.id }), 'http://gr8r.example:8787/#project/gr');
  assert.equal(await linkOf({ id: p.id }), 'http://gr8r.example:8787/#project/gr');
});

test('the label picker and filter work on free-form labels, and on a built-in one spelled differently', async () => {
  const { matchF, FIELDS } = await import('../src/shell/view-engine.js');
  const t = { id: 't1', key: 'GR-1', project: 'p1', title: 'x', status: 'todo', subtasks: [], deps: [], labels: ['Bug', 'Improvement'], order: 1 };
  S.data = { ...emptyWorkspace(), teams: TEAMS_SEED.map(x => ({ ...x })), tasks: [t] };
  assert.ok(FIELDS.labels.opts().some(o => o.id === 'Improvement'));
  assert.ok(matchF(t, { f: 'labels', v: ['bug'] }));
  assert.ok(matchF(t, { f: 'labels', v: ['Improvement'] }));
  S.ui.pop = { type: 'labels', id: 't1' };
  app.A.popToggleLabel({ dataset: { v: 'bug' } });
  assert.deepEqual(S.data.tasks[0].labels, ['Improvement']);
  app.A.popToggleLabel({ dataset: { v: 'Feature' } });
  assert.deepEqual(S.data.tasks[0].labels, ['Improvement', 'Feature']);
});

test('board columns keep the order the view sorts them in', async () => {
  const { applyView } = await import('../src/shell/view-engine.js');
  const { boardHtml } = await import('../src/views/board.js');
  const t = (id, order, created) => ({
    id,
    key: id.toUpperCase(),
    project: 'p1',
    title: id,
    status: 'done',
    subtasks: [],
    deps: [],
    labels: [],
    priority: 'none',
    order,
    created,
  });
  S.data = { ...emptyWorkspace(), teams: TEAMS_SEED.map(x => ({ ...x })), tasks: [t('t1', 1, 100), t('t2', 2, 300), t('t3', 3, 200)] };
  const cards = v => [...boardHtml(applyView(S.data.tasks, v), 'test').matchAll(/data-id="(t\d)"/g)].map(m => m[1]).filter((id, i, a) => a.indexOf(id) === i);
  const view = sort => ({ filters: [], q: '', sort, showDone: true });
  assert.deepEqual(cards(view({ f: 'manual', dir: 1 })), ['t1', 't2', 't3']);
  assert.deepEqual(cards(view({ f: 'created', dir: 1 })), ['t2', 't3', 't1']);
});

test('duplicating a task takes the next key number, without skipping one', () => {
  const p = { ...emptyWorkspace().projects[0], id: 'p1', key: 'GR', seq: 3 };
  const t = { id: 't1', key: 'GR-3', project: 'p1', title: 'Write', status: 'todo', subtasks: [], deps: [], labels: [], order: 1 };
  S.data = { ...emptyWorkspace(), teams: TEAMS_SEED.map(x => ({ ...x })), projects: [p], tasks: [t] };
  app.A.dupTask({ dataset: { id: 't1' } });
  const copy = S.data.tasks.find(x => x.id !== 't1');
  assert.equal(copy.key, 'GR-4');
  assert.equal(S.data.projects[0].seq, 4);
});
