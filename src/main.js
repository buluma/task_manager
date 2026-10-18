/* =====================================================================
   ENTRY: styles, then every module in dependency order (several register
   global listeners or add handlers to the action table when they load), then boot.
   ===================================================================== */
import './styles/index.css';
import './core/utils.js';
import './core/icons.js';
import { adoptPriorities } from './core/priorities.js';
import './data/seed.js';
import './core/store.js';
import './ui/helpers.js';
import './core/theme.js';
import './ui/toast.js';
import './ui/select.js';
import './shell/render.js';
import './shell/layout.js';
import './shell/skeletons.js';
import './shell/view-engine.js';
import './components/task-list.js';
import './pages/home.js';
import './pages/overview.js';
import './pages/my-tasks.js';
import './pages/tasks.js';
import './pages/inbox.js';
import './pages/favorites.js';
import './pages/projects.js';
import './pages/members.js';
import './pages/activity.js';
import './pages/search.js';
import './pages/errors.js';
import './pages/project.js';
import './views/project-overview.js';
import './views/board.js';
import './views/table.js';
import './views/calendar.js';
import './views/timeline.js';
import './views/files.js';
import './overlays/drawer.js';
import './overlays/modals.js';
import './overlays/popovers.js';
import './overlays/context-menu.js';
import './overlays/palette.js';
import './pages/settings.js';
import './pages/auth.js';
import './actions/actions.js';
import './actions/events.js';
import './actions/keyboard.js';
import './actions/drag-drop.js';
import './features/teams.js';
import './features/subtasks.js';
import './features/archive.js';
import './actions/teams.js';
import './actions/subtasks.js';
import './actions/archive.js';
import './actions/priorities.js';
import { rollNow } from './actions/cycles.js';
import { S, D, cache } from './core/store.js';
import { watchRemote } from './core/sync.js';
import { A } from './actions/actions.js';
import { ROUTE_NAMES, render, go } from './shell/render.js';
import { toast } from './ui/toast.js';

(function init() {
  document.documentElement.lang = 'en';
  if (!document.getElementById('sr-live')) {
    const l = document.createElement('div');
    l.id = 'sr-live';
    l.className = 'sr';
    l.setAttribute('aria-live', 'polite');
    document.body.appendChild(l);
  }
  // #notifications was folded into the Inbox; keep old links working.
  const h = (location.hash || '').slice(1).replace(/^notifications$/, 'inbox');
  const authRoutes = ['login', 'signup', 'forgot', 'reset', 'verify', 'onboarding'];
  if (authRoutes.includes(h)) S.ui.auth = h;
  else if (h && ROUTE_NAMES[h]) S.ui.route = h;
  else S.ui.route = S.prefs.home || 'home';
  rollNow();
  render();
})();

// Leave the app open past midnight Sunday and the new cycle still starts: re-check when the tab regains focus and hourly.
const rollIfNewCycle = () => rollNow() && render();
document.addEventListener('visibilitychange', () => !document.hidden && rollIfNewCycle());
setInterval(rollIfNewCycle, 36e5);

// Another device saved first; sync is paused so its changes aren't overwritten.
window.addEventListener('gr8r:conflict', () =>
  toast('Changed on another device. Reload to get the latest.', { kind: 'err', action: 'Reload', onAction: () => location.reload(), ms: 600000 }),
);

const idle = () =>
  !S.ui.auth && !S.ui.modals.length && !S.ui.composer && !S.ui.editCell && !S.ui.pop && !document.activeElement?.matches('input,textarea,[contenteditable]');

// Adopt changes made elsewhere (CLI, another device) unless the user is mid-edit.
watchRemote(state => {
  S.data = state.data;
  adoptPriorities(S.data);
  cache();
  render();
}, idle);

// A save lost the race and sync.js merged it with the other write. Adopt the result now, even mid-edit, or the
// next save would undo the other write; only the redraw waits for idle. Say so only where theirs won a clash.
window.addEventListener('gr8r:merged', ({ detail: { state, conflicts } }) => {
  S.data = state.data;
  S.prefs = state.prefs;
  S.views = state.views;
  adoptPriorities(S.data);
  cache();
  if (idle()) render();
  if (!conflicts.length) return;
  const keys = [...new Set(conflicts.filter(c => c[0] === 'data' && c[1] === 'tasks').map(c => S.data.tasks.find(t => t.id === c[2])?.key))].filter(Boolean);
  const where = keys.length ? (keys.length > 3 ? `${keys.length} tasks` : keys.join(', ')) : `${conflicts.length} setting${conflicts.length === 1 ? '' : 's'}`;
  toast(`Another device changed the same thing on ${where}; kept its version.`, { kind: 'info', ms: 10000 });
});

// Dev-only handle for debugging and screenshot tooling; stripped from production builds.
if (import.meta.env.DEV) window.__gr8r = { S, D, A, go, render };
