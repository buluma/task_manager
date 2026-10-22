/* Optional personal-server sync. The durable outbox survives offline starts and reloads. */
import { mergeState } from './merge.js';

const URL_STATE = '/api/state';
const RETRY_MS = 5000;
const POLL_MS = 5000;
const MAX_MERGES = 3;
export const SYNC_KEY = 'gr8r.sync.v1';

let rev = 0;
let busy = false;
let pending = null;
let base = null;
let available = false;
let halted = false;
let retry = null;
let edits = 0;
let polling = false;

function remember() {
  try {
    localStorage.setItem(SYNC_KEY, JSON.stringify({ rev, base, pending }));
  } catch {
    // store.js also caches the displayed state; unavailable storage leaves this session in memory.
  }
}

/* Restore the outbox before reading the server, so a reload cannot replace unsent work. */
export async function initialize(local) {
  try {
    const saved = JSON.parse(localStorage.getItem(SYNC_KEY));
    if (Number.isInteger(saved?.rev) && saved.rev >= 0) {
      rev = saved.rev;
      base = saved.base;
      pending = saved.pending;
    }
  } catch {
    // An older installation, blocked storage or corrupt metadata can still use its workspace cache.
  }
  if (pending) return structuredClone(pending);
  return (await pull()) || local;
}

export const hasPending = () => !!pending;
export const needsSeed = () => available && base === null;
export const syncing = () => available && !halted;

/* Stage synchronously, before the network debounce, so closing the tab cannot lose the last edit. */
export function stage(state) {
  edits++;
  pending = structuredClone(state);
  remember();
}

async function latest() {
  const r = await fetch(URL_STATE, { cache: 'no-store', signal: AbortSignal.timeout(3000) });
  if (r.status === 404) return { rev: 0, state: null };
  if (!r.ok) throw new Error(`sync failed: ${r.status}`);
  return r.json();
}

export async function pull(isCurrent = () => true) {
  try {
    const j = await latest();
    if (!isCurrent()) return null;
    available = true;
    rev = j.rev;
    base = structuredClone(j.state);
    remember();
    return j.state;
  } catch {
    available = false;
    return null;
  }
}

/* Polling also reconnects a tab opened while the server was unavailable. */
export function watchRemote(apply, idle) {
  setInterval(async () => {
    if (halted || busy || polling || document.hidden || !idle()) return;
    if (pending) {
      await push();
      return;
    }
    const generation = edits;
    const isCurrent = () => !halted && !busy && !pending && edits === generation && !document.hidden && idle();
    polling = true;
    try {
      const r = await fetch('/api/rev', { cache: 'no-store', signal: AbortSignal.timeout(3000) });
      if (!r.ok || (await r.json()).rev === rev || !isCurrent()) return;
      const state = await pull(isCurrent);
      if (state) apply(state);
    } catch {
      available = false;
    } finally {
      polling = false;
    }
  }, POLL_MS);
}

/* Other writers lose no unrelated fields: a stale revision is merged against the durable baseline. */
export async function push(state) {
  if (state !== undefined) stage(state);
  if (halted || busy) return;
  clearTimeout(retry);
  busy = true;
  let sent = null;
  let merges = 0;
  try {
    while (pending) {
      sent = pending;
      pending = null;
      const r = await fetch(URL_STATE, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ baseRev: rev, state: sent }),
        signal: AbortSignal.timeout(5000),
      });
      if (r.status === 409) {
        const now = merges++ < MAX_MERGES ? await latest() : null;
        if (!now) {
          halted = true;
          pending ??= sent;
          remember();
          window.dispatchEvent(new Event('gr8r:conflict'));
          break;
        }
        const { state, conflicts } = mergeState(base ?? undefined, pending ?? sent, now.state);
        rev = now.rev;
        base = now.state;
        pending = state;
        remember();
        window.dispatchEvent(new CustomEvent('gr8r:merged', { detail: { state: structuredClone(state), conflicts } }));
      } else if (r.ok) {
        rev = (await r.json()).rev;
        base = sent;
        available = true;
        remember();
      } else throw new Error(`sync failed: ${r.status}`);
    }
  } catch {
    available = false;
    pending ??= sent;
    remember();
    retry = setTimeout(() => pending && push(), RETRY_MS);
    retry?.unref?.();
  } finally {
    busy = false;
  }
}
