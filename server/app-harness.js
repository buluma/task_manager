/* Loads the browser app's real action code under Node, for tests that drive it (parity.test.js, app-actions.test.js).
   actions.js pulls in the whole UI: it gets the Vite-only icon module as an empty one, and the few browser globals
   it touches as inert stubs, so render calls run and draw nothing. Needs Node 22.15+ (module.registerHooks). */
import { registerHooks } from 'node:module';

registerHooks({
  resolve: (spec, ctx, next) => (spec === 'virtual:icons' ? { url: 'data:text/javascript,export const ICONS = {}', shortCircuit: true } : next(spec, ctx)),
});
const inert = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : inert), apply: () => inert });
/* Form inputs a handler reads with $('#id'): a test puts { value } here, keyed by selector, before calling it. */
export const fields = {};
/* For drag-drop.test.js: the listeners modules add to the document, by event type, and `page.root`, a fake-dom.js tree
   the document's queries search first when a test sets it. Anything not found there is still inert. */
export const listeners = {};
export const page = { root: null };
const document = new Proxy(inert, {
  get: (_, k) => {
    if (k === 'addEventListener') return (type, fn) => (listeners[type] ??= []).push(fn);
    if (k === 'querySelector') return sel => fields[sel] ?? page.root?.querySelector(sel) ?? inert;
    if (k === 'querySelectorAll') return sel => (page.root ? page.root.querySelectorAll(sel) : []);
    return inert;
  },
});
Object.assign(globalThis, {
  document,
  addEventListener() {},
  matchMedia: inert,
  innerWidth: 1280,
  innerHeight: 800,
  localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
});

// Every module that adds handlers to the action tables, as main.js loads them (main.js itself starts timers).
export const app = await import('../src/actions/actions.js');
for (const m of ['events', 'keyboard', 'drag-drop', 'teams', 'subtasks', 'archive', 'priorities', 'labels', 'cycles']) await import(`../src/actions/${m}.js`);
export const { S, task } = await import('../src/core/store.js');
export const { emptyWorkspace } = await import('../src/data/seed.js');
