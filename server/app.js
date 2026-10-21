/* Personal sync server: stores the whole app state as one JSON file and serves the built app.
   Revision numbers stop a stale tab or device from silently overwriting newer data. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, archiveTask, createTask, findTask, listTasks, localIso, patchTask, purgeTask, rand } from './tasks.js';
import { archiveProject, createProject, findProject, listProjects, patchProject, purgeProject } from './projects.js';
import { addDep, addSubtask, deleteSubtask, listDeps, patchSubtask, removeDep } from './relations.js';
import { addComment, deleteComment, editComment, listComments } from './comments.js';
import { createNotification, listNotifications, setRead } from './notifications.js';
import { addAgent, findAgent, listAgents } from './agents.js';
import { createPrStates, linkedPrRefs, reviewPrs } from './github.js';
import { addPriority, deletePriority, listPriorities, patchPriority } from './priorities.js';
import { changeLabel, createLabel, deleteLabel, listLabels } from './labels.js';
import {
  addMilestone,
  createMembers,
  createTeam,
  deleteMember,
  deleteMilestone,
  deleteTeam,
  listMembers,
  listMilestones,
  listTeams,
  patchMember,
  patchMilestone,
  patchTeam,
} from './people.js';

const MAX_BODY = 10 * 1024 * 1024;
const MAX_PR_REFS = 200;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};
/* Views are HTML strings, so a missed esc() is an injection. This keeps one from running script: only bundled
   files execute. Inline style attributes are everywhere, and Geist comes from Google Fonts. */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ');

/* `token` (GR8R_TOKEN) guards the task, project and priority APIs. /api/rev and /api/state stay open because
   the browser app syncs through them without credentials, so the token stops casual API use, not a determined
   write to the whole state; keep the server on a private interface. `githubToken` is for PR states (github.js);
   `prStates` replaces that lookup in tests. */
export function createApp({ dataFile, distDir, now = () => new Date(), token, githubToken, prStates = createPrStates({ token: githubToken }) }) {
  let current = readStored(dataFile);
  const digest = s => crypto.createHash('sha256').update(s).digest();
  const expected = token ? digest(`Bearer ${token}`) : null;
  function authorize(req, res) {
    if (!expected || crypto.timingSafeEqual(digest(req.headers.authorization || ''), expected)) return;
    res.setHeader('www-authenticate', 'Bearer realm="gr8r"');
    throw new ApiError(401, 'unauthorized: send "Authorization: Bearer <token>" (the CLI reads GR8R_TOKEN)');
  }

  const json = (res, status, body) => {
    res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(body));
  };

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      let size = 0;
      req.on('data', c => {
        size += c.length;
        // Keep draining instead of destroying the socket, or the client sees a reset instead of the 413.
        if (size > MAX_BODY) reject(Object.assign(new Error('too large'), { status: 413 }));
        else chunks.push(c);
      });
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
      req.on('error', reject);
    });
  }

  /* Shared guard for every write: same-origin only, JSON only, bounded size. */
  async function readJson(req, what) {
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new ApiError(403, 'cross-origin write refused');
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) throw new ApiError(415, 'content-type must be application/json');
    try {
      return JSON.parse(await readBody(req));
    } catch (e) {
      if (e.status === 413) throw new ApiError(413, `${what} too large`);
      throw new ApiError(400, 'invalid JSON');
    }
  }

  async function handleState(req, res) {
    if (req.method === 'GET') {
      if (!current) return json(res, 404, { error: 'no state saved yet' });
      return json(res, 200, current);
    }
    if (req.method !== 'PUT') {
      res.setHeader('allow', 'GET, PUT');
      return json(res, 405, { error: 'method not allowed' });
    }
    const body = await readJson(req, 'state');
    if (!Number.isInteger(body?.baseRev) || !body?.state?.data?.tasks)
      return json(res, 400, { error: 'expected { baseRev: integer, state: { data: { tasks } } }' });
    const rev = current?.rev ?? 0;
    if (body.baseRev !== rev) return json(res, 409, { rev });
    current = { rev: rev + 1, state: body.state };
    writeStored(dataFile, current);
    return json(res, 200, { rev: current.rev });
  }

  /* Runs one task change against a copy of the state; it only becomes current once it is on disk. `actor` is the
     member id the change is logged to (an agent), or undefined for the owner; it lives on the copy only while the
     change runs. */
  function mutateAs(actor, change) {
    if (!current) throw new ApiError(409, 'no workspace yet: open the app once so it can save its starting state');
    const state = structuredClone(current.state);
    if (actor) state.data.actor = actor;
    const result = change(state.data, state.prefs, localIso(now()), now().getTime());
    delete state.data.actor;
    const next = { rev: current.rev + 1, state };
    writeStored(dataFile, next);
    current = next;
    return result;
  }
  const needState = () => {
    if (!current) throw new ApiError(409, 'no workspace yet: open the app once so it can save its starting state');
    return current.state;
  };

  async function handleApi(req, res, url) {
    const parts = url.pathname.split('/').slice(2).map(decodeURIComponent);
    const [what, key] = parts;
    const method = req.method;
    const allow = (...m) => {
      if (m.includes(method)) return;
      res.setHeader('allow', m.join(', '));
      throw new ApiError(405, 'method not allowed');
    };
    if (what === 'rev' && parts.length === 1) {
      allow('GET');
      return json(res, 200, { rev: current?.rev ?? 0 });
    }
    /* Open like /api/rev, for the browser's PR icons; it only asks GitHub about PRs linked in a comment, so it
       cannot be used to probe other repos with the token. */
    if (what === 'prs' && parts.length === 1) {
      allow('GET');
      const refs = [...new Set(url.searchParams.getAll('ref'))];
      if (refs.length > MAX_PR_REFS) throw new ApiError(400, `at most ${MAX_PR_REFS} refs at a time`);
      const linked = linkedPrRefs(needState().data);
      const found = await prStates(refs.filter(r => linked.has(r)));
      return json(res, 200, { prs: Object.fromEntries(refs.map(r => [r, found[r] ?? null])) });
    }
    authorize(req, res);
    // X-Gr8r-Agent attributes a write to a registered agent; it is not authentication (see agents.js).
    const named = req.headers['x-gr8r-agent'];
    const actor = named === undefined ? undefined : findAgent(needState().data, named).id;
    const mutate = change => mutateAs(actor, change);
    if (what === 'agents' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { agents: listAgents(needState().data) });
      const body = await readJson(req, 'agent');
      return json(res, 201, { agent: mutate(d => addAgent(d, body)) });
    }
    if (what === 'notifications' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { notifications: listNotifications(needState().data, url.searchParams) });
      const body = await readJson(req, 'notification');
      return json(res, 201, { notification: mutate((d, p, today, t) => createNotification(d, body, t)) });
    }
    if (what === 'notifications' && parts.length === 2) {
      allow('PATCH');
      const body = await readJson(req, 'notification');
      return json(res, 200, { notification: mutate(d => setRead(d, key, body)) });
    }
    if (what === 'projects' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { projects: listProjects(needState().data, url.searchParams) });
      const body = await readJson(req, 'project');
      return json(res, 201, { project: mutate((d, p, today, t) => createProject(d, today, body, t)) });
    }
    if (what === 'projects' && parts.length === 2) {
      allow('GET', 'PATCH', 'DELETE');
      if (method === 'GET') return json(res, 200, { project: findProject(needState().data, key) });
      if (method === 'DELETE') {
        if (url.searchParams.get('purge'))
          return json(
            res,
            200,
            mutate(d => purgeProject(d, key)),
          );
        return json(res, 200, { project: mutate((d, p, today, t) => archiveProject(d, key, t)) });
      }
      const body = await readJson(req, 'project');
      return json(res, 200, { project: mutate((d, p, today, t) => patchProject(d, key, body, t)) });
    }
    if (what === 'projects' && parts[2] === 'milestones' && parts.length === 3) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { milestones: listMilestones(needState().data, key) });
      const body = await readJson(req, 'milestone');
      return json(res, 201, { milestone: mutate(d => addMilestone(d, key, body)) });
    }
    if (what === 'projects' && parts[2] === 'milestones' && parts.length === 4) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') return json(res, 200, { milestone: mutate(d => deleteMilestone(d, key, parts[3])) });
      const body = await readJson(req, 'milestone');
      return json(res, 200, { milestone: mutate(d => patchMilestone(d, key, parts[3], body)) });
    }
    if (what === 'members' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { members: listMembers(needState().data) });
      const body = await readJson(req, 'member');
      return json(res, 201, { members: mutate(d => createMembers(d, body)) });
    }
    if (what === 'members' && parts.length === 2) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') return json(res, 200, { member: mutate(d => deleteMember(d, key)) });
      const body = await readJson(req, 'member');
      return json(res, 200, { member: mutate(d => patchMember(d, key, body)) });
    }
    if (what === 'teams' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { teams: listTeams(needState().data) });
      const body = await readJson(req, 'team');
      return json(res, 201, { team: mutate(d => createTeam(d, body)) });
    }
    if (what === 'teams' && parts.length === 2) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') return json(res, 200, { team: mutate(d => deleteTeam(d, key)) });
      const body = await readJson(req, 'team');
      return json(res, 200, { team: mutate(d => patchTeam(d, key, body)) });
    }
    if (what === 'labels' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { labels: listLabels(needState().data) });
      const body = await readJson(req, 'label');
      return json(res, 201, { label: mutate(d => createLabel(d, body)) });
    }
    if (what === 'labels' && parts.length === 2) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') return json(res, 200, { removed: mutate((d, p, today, t) => deleteLabel(d, key, t)) });
      const body = await readJson(req, 'label');
      return json(res, 200, { label: mutate(d => changeLabel(d, key, body)) });
    }
    if (what === 'priorities' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { priorities: listPriorities(needState().data) });
      const body = await readJson(req, 'priority');
      return json(res, 201, { priority: mutate(d => addPriority(d, body)) });
    }
    if (what === 'priorities' && parts.length === 2) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') {
        const replace = url.searchParams.get('replace') ?? undefined;
        return json(res, 200, { moved: mutate((d, p, today, t) => deletePriority(d, key, replace, t)) });
      }
      const body = await readJson(req, 'priority');
      return json(res, 200, { priority: mutate(d => patchPriority(d, key, body)) });
    }
    if (what === 'tasks' && parts.length === 1) {
      allow('GET', 'POST');
      if (method === 'GET') {
        const s = needState();
        return json(res, 200, { tasks: listTasks(s.data, s.prefs, url.searchParams, localIso(now())) });
      }
      const body = await readJson(req, 'task');
      return json(res, 201, { task: mutate((d, p, today, t) => createTask(d, p, today, body, t)) });
    }
    if (what === 'tasks' && parts[2] === 'subtasks' && parts.length === 3) {
      allow('POST');
      const body = await readJson(req, 'subtask');
      return json(res, 201, { subtask: mutate((d, p, today, t) => addSubtask(d, key, body, t)) });
    }
    if (what === 'tasks' && parts[2] === 'subtasks' && parts.length === 4) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') return json(res, 200, { subtask: mutate((d, p, today, t) => deleteSubtask(d, key, parts[3], t)) });
      const body = await readJson(req, 'subtask');
      return json(res, 200, { subtask: mutate((d, p, today, t) => patchSubtask(d, key, parts[3], body, t)) });
    }
    if (what === 'tasks' && parts[2] === 'deps' && parts.length === 3) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { deps: listDeps(needState().data, key) });
      const body = await readJson(req, 'dependency');
      return json(res, 201, { deps: mutate((d, p, today, t) => addDep(d, key, body, t)) });
    }
    if (what === 'tasks' && parts[2] === 'deps' && parts.length === 4) {
      allow('DELETE');
      return json(res, 200, { deps: mutate((d, p, today, t) => removeDep(d, key, parts[3], t)) });
    }
    if (what === 'tasks' && parts[2] === 'comments' && parts.length === 3) {
      allow('GET', 'POST');
      if (method === 'GET') return json(res, 200, { comments: listComments(needState().data, key) });
      const body = await readJson(req, 'comment');
      return json(res, 201, { comment: mutate((d, p, today, t) => addComment(d, key, body, t)) });
    }
    if (what === 'tasks' && parts[2] === 'comments' && parts.length === 4) {
      allow('PATCH', 'DELETE');
      if (method === 'DELETE') return json(res, 200, { comment: mutate(d => deleteComment(d, key, parts[3])) });
      const body = await readJson(req, 'comment');
      return json(res, 200, { comment: mutate(d => editComment(d, key, parts[3], body)) });
    }
    if (what === 'tasks' && parts.length === 2) {
      allow('GET', 'PATCH', 'DELETE');
      if (method === 'GET') return json(res, 200, { task: findTask(needState().data, key) });
      if (method === 'DELETE') {
        if (url.searchParams.get('purge')) return json(res, 200, { task: mutate(d => purgeTask(d, key)) });
        return json(res, 200, { task: mutate((d, p, today, t) => archiveTask(d, key, t)) });
      }
      const body = await readJson(req, 'task');
      const { task, next } = mutate((d, p, today, t) => patchTask(d, p, today, key, body, t));
      return json(res, 200, next ? { task, next } : { task });
    }
    throw new ApiError(404, 'not found');
  }

  function handleStatic(req, res) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return json(res, 405, { error: 'method not allowed' });
    let rel;
    try {
      rel = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    } catch {
      rel = '/';
    }
    let file = path.join(distDir, rel);
    const inside = file === distDir || file.startsWith(distDir + path.sep);
    if (!inside || !isFile(file)) file = path.join(distDir, 'index.html');
    if (!isFile(file)) return json(res, 404, { error: 'not built: run npm run build' });
    // Vite puts content-hashed files under assets/, so they never change; everything else revalidates.
    const hashed = file.startsWith(path.join(distDir, 'assets') + path.sep);
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file)] || 'application/octet-stream',
      'cache-control': hashed ? 'public, max-age=31536000, immutable' : 'no-cache',
      'content-security-policy': CSP,
      'x-content-type-options': 'nosniff',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  /* Moves each task in Review whose linked PR has merged to Done, with an Inbox item naming the PR, and returns their
     keys. index.js runs it every 10 minutes. A task is moved once per PR while the server runs, so one put back in
     Review by hand stays there. Writes only when something moves. */
  const closed = new Set();
  async function closeMergedReviews() {
    if (!current) return [];
    const unseen = w => !closed.has(`${w.id} ${w.ref}`);
    const refs = [
      ...new Set(
        reviewPrs(current.state.data)
          .filter(unseen)
          .map(w => w.ref),
      ),
    ];
    if (!refs.length) return [];
    const states = await prStates(refs);
    // read again after the wait: the state may have moved on while GitHub answered
    const merged = reviewPrs(current.state.data).filter(w => unseen(w) && states[w.ref] === 'merged');
    if (!merged.length) return [];
    const keys = mutateAs(undefined, (d, p, today, t) =>
      merged.map(w => {
        patchTask(d, p, today, w.key, { status: 'done' }, t);
        (d.notifs ??= []).push({
          id: 'n' + rand(),
          type: 'update',
          by: d.me,
          task: w.id,
          text: 'moved to Done',
          snippet: `${w.ref} merged`,
          at: t,
          read: false,
        });
        return w.key;
      }),
    );
    for (const w of merged) closed.add(`${w.id} ${w.ref}`);
    return keys;
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname === '/api/state' ? handleState : url.pathname.startsWith('/api/') ? handleApi : handleStatic;
    Promise.resolve(route(req, res, url)).catch(e => {
      if (e instanceof ApiError) return json(res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
  server.closeMergedReviews = closeMergedReviews;
  return server;
}

function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

function readStored(file) {
  for (const f of [file, `${file}.bak`]) {
    try {
      const j = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (Number.isInteger(j?.rev) && j?.state?.data?.tasks) return j;
    } catch (e) {
      if (e.code !== 'ENOENT') console.error(`ignoring unreadable ${f}: ${e.message}`);
    }
  }
  return null;
}

function writeStored(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  // Sync the data before the rename and the directory after it, or a power cut can leave an empty state.json.
  const fd = fs.openSync(tmp, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
  const dir = fs.openSync(path.dirname(file), 'r');
  try {
    fs.fsyncSync(dir);
  } finally {
    fs.closeSync(dir);
  }
}
