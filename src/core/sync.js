/* ---------- sync with the personal server (server/app.js) ----------
   Optional: when /api/state is unreachable (static hosting, server stopped) the app keeps
   working from localStorage alone. */
import { mergeState } from './merge.js';

const URL_STATE = '/api/state';
const RETRY_MS = 5000;
const POLL_MS = 5000;
const MAX_MERGES = 3; // per save: a server that keeps moving gets the old stop-and-reload behaviour

let rev = null; // null: no server, or syncing halted after a conflict
let busy = false;
let pending = null;
let base = null; // the state as of `rev`, which a merge after a 409 starts from

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
    base = structuredClone(j.state);
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

async function latest() {
  const r = await fetch(URL_STATE, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  return r.ok ? r.json() : null;
}

/* Sends the latest state; saves arriving mid-flight collapse into one follow-up request. When another writer
   saved first, merges with what it wrote and saves that instead, and hands the result to the app
   (gr8r:merged) so later saves build on it. */
export async function push(state) {
  if (rev === null) return;
  pending = state;
  if (busy) return;
  busy = true;
  let sent = null;
  let merges = 0;
  try {
    while (pending) {
      sent = pending;
      pending = null;
      const r = await fetch(URL_STATE, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseRev: rev, state: sent }) });
      if (r.status === 409) {
        const now = merges++ < MAX_MERGES ? await latest() : null;
        if (!now) {
          // Can't merge: stop writing so the other save isn't clobbered; the user reloads to pick it up.
          rev = null;
          window.dispatchEvent(new Event('gr8r:conflict'));
          continue;
        }
        // A save made while we waited is newer than `sent` and already contains it.
        const { state, conflicts } = mergeState(base, pending ?? sent, now.state);
        rev = now.rev;
        base = now.state;
        pending = state;
        window.dispatchEvent(new CustomEvent('gr8r:merged', { detail: { state: structuredClone(state), conflicts } }));
      } else if (r.ok) {
        rev = (await r.json()).rev;
        base = sent;
      } else throw new Error(`sync failed: ${r.status}`);
    }
  } catch {
    // Server unreachable: localStorage still has the change. Retry with whatever is newest.
    pending ??= sent;
    setTimeout(() => pending && push(pending), RETRY_MS);
  } finally {
    busy = false;
  }
}
