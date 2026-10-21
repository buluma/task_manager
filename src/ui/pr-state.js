/* ---------- PR icons coloured by state: open, draft, merged or closed ----------
   States come from the server's GET /api/prs (server/github.js), asked for in one batch after a render and kept a
   few minutes. Until they arrive, or with no server, the icon is drawn plain. */
import { esc } from '../core/utils.js';
import { ic } from '../core/icons.js';
import { prLook, prRef } from '../core/pr-links.js';
import { render } from '../shell/render.js';

const TTL = 5 * 60e3;
const CHUNK = 200; // the server's limit per request
const known = new Map(); // ref -> { state, until }
const wanted = new Set();
let timer = null;

function stateOf(pr) {
  const ref = prRef(pr);
  const hit = known.get(ref);
  if (!hit || hit.until < Date.now()) {
    wanted.add(ref);
    timer ??= setTimeout(ask, 0);
  }
  return hit?.state ?? null;
}

async function ask() {
  timer = null;
  const refs = [...wanted];
  wanted.clear();
  // held until the answer, or the TTL on failure, so renders in between don't ask again
  for (const r of refs) known.set(r, { state: known.get(r)?.state ?? null, until: Date.now() + TTL });
  let changed = false;
  for (let i = 0; i < refs.length; i += CHUNK) {
    const q = new URLSearchParams(refs.slice(i, i + CHUNK).map(r => ['ref', r]));
    try {
      const res = await fetch(`/api/prs?${q}`, { cache: 'no-store', signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      for (const [r, state] of Object.entries((await res.json()).prs || {})) {
        if (known.get(r)?.state !== state) changed = true;
        known.set(r, { state, until: Date.now() + TTL });
      }
    } catch {
      /* no server, or it is down: keep the plain icon and try again after the TTL */
    }
  }
  if (changed) render();
}

/* How a task's linked `pr` is drawn right now: its state's icon, colour and name (see prLook). */
export const prLookOf = pr => prLook(stateOf(pr));

/* The PR icon for a task's linked `pr`, in the state's colour, with `cls` for where it sits. */
export function prBadge(pr, size, cls) {
  const { icon, color, name } = prLookOf(pr);
  const tip = `PR #${pr.number} · ${esc(pr.repo)}${name ? ` · ${name}` : ''}`;
  return `<span class="${cls}" data-tip="${tip}" aria-label="Pull request #${pr.number}${name ? `, ${name.toLowerCase()}` : ' linked'}"${color ? ` style="color:${color}"` : ''}>${ic(icon, size)}</span>`;
}
