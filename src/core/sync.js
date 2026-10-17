/* ---------- sync with the personal server (server/app.js) ----------
   Optional: when /api/state is unreachable (static hosting, server stopped) the app keeps
   working from localStorage alone. */
const URL_STATE = '/api/state';
const RETRY_MS = 5000;
const POLL_MS = 5000;

let rev = null; // null: no server, or syncing halted after a conflict
let busy = false;
let pending = null;

/* Returns the server's saved state, or null when it has none yet or can't be reached. */
export async function pull() {
  try {
    const r = await fetch(URL_STATE, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
    if (r.status === 404) {
      rev = 0;
      return null;
    }
    if (!r.ok) return null;
    const j = await r.json();
    rev = j.rev;
    return j.state;
  } catch {
    return null;
  }
}

export const syncing = () => rev !== null;

/* Other writers (the gr8r CLI, another device) bump the server revision. When this tab has nothing
   in flight and `idle()` says the user isn't mid-edit, adopt their state instead of waiting for a 409. */
export function watchRemote(apply, idle) {
  setInterval(async () => {
    if (rev === null || busy || pending || document.hidden || !idle()) return;
    try {
      const r = await fetch('/api/rev', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!r.ok || (await r.json()).rev === rev) return;
      const state = await pull();
      if (state) apply(state);
    } catch {
      /* server unreachable: try again next tick */
    }
  }, POLL_MS);
}

/* Sends the latest state; saves arriving mid-flight collapse into one follow-up request. */
export async function push(state) {
  if (rev === null) return;
  pending = state;
  if (busy) return;
  busy = true;
  let sent = null;
  try {
    while (pending) {
      sent = pending;
      pending = null;
      const r = await fetch(URL_STATE, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: rev, state: sent }) });
      if (r.status === 409) {
        // Another device saved first. Stop writing so it isn't clobbered; the user reloads to pick it up.
        rev = null;
        window.dispatchEvent(new Event('gr8r:conflict'));
      } else if (r.ok) rev = (await r.json()).rev;
      else throw new Error(`sync failed: ${r.status}`);
    }
  } catch {
    // Server unreachable: localStorage still has the change. Retry with whatever is newest.
    pending ??= sent;
    setTimeout(() => pending && push(pending), RETRY_MS);
  } finally {
    busy = false;
  }
}
