/* Loads the browser app's real action code under Node, for tests that drive it (parity.test.js, app-actions.test.js).
   actions.js pulls in the whole UI: it gets the Vite-only icon module as an empty one, and the few browser globals
   it touches as inert stubs, so render calls run and draw nothing. Needs Node 22.15+ (module.registerHooks). */
import { registerHooks } from 'node:module';

registerHooks({
  resolve: (spec, ctx, next) => (spec === 'virtual:icons' ? { url: 'data:text/javascript,export const ICONS = {}', shortCircuit: true } : next(spec, ctx)),
});
const inert = new Proxy(function () {}, { get: (_, k) => (k === Symbol.toPrimitive ? () => '' : inert), apply: () => inert });
Object.assign(globalThis, { document: inert, addEventListener() {}, matchMedia: inert, localStorage: { getItem: () => null, setItem() {}, removeItem() {} } });

// Every module that adds handlers to the action tables, as main.js loads them (main.js itself starts timers).
export const app = await import('../src/actions/actions.js');
for (const m of ['events', 'keyboard', 'drag-drop', 'teams', 'subtasks', 'archive', 'priorities', 'cycles']) await import(`../src/actions/${m}.js`);
export const { S, task } = await import('../src/core/store.js');
export const { emptyWorkspace } = await import('../src/data/seed.js');
