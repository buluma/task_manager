/* Personal sync server: stores the whole app state as one JSON file and serves the built app.
   Revision numbers stop a stale tab or device from silently overwriting newer data. */
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, archiveTask, createTask, findTask, listTasks, localIso, patchTask, purgeTask } from './tasks.js';
import { archiveProject, createProject, findProject, listProjects, patchProject, purgeProject } from './projects.js';
import { addDep, addSubtask, deleteSubtask, listDeps, patchSubtask, removeDep } from './relations.js';
import { addComment, deleteComment, listComments } from './comments.js';
import { addPriority, deletePriority, listPriorities, patchPriority } from './priorities.js';

const MAX_BODY = 10 * 1024 * 1024;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/* `token` (GR8R_TOKEN) guards the task, project and priority APIs. /api/rev and /api/state stay open because
   the browser app syncs through them without credentials, so the token stops casual API use, not a determined
   write to the whole state; keep the server on a private interface. */
export function createApp({ dataFile, distDir, now = () => new Date(), token }) {
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

  /* Runs one task change against a copy of the state; it only becomes current once it is on disk. */
  function mutate(change) {
    if (!current) throw new ApiError(409, 'no workspace yet: open the app once so it can save its starting state');
    const state = structuredClone(current.state);
    const result = change(state.data, state.prefs, localIso(now()), now().getTime());
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
    authorize(req, res);
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
      allow('DELETE');
      return json(res, 200, { comment: mutate(d => deleteComment(d, key, parts[3])) });
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
    if (!inside || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(distDir, 'index.html');
    if (!fs.existsSync(file)) return json(res, 404, { error: 'not built: run npm run build' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const route = url.pathname === '/api/state' ? handleState : url.pathname.startsWith('/api/') ? handleApi : handleStatic;
    Promise.resolve(route(req, res, url)).catch(e => {
      if (e instanceof ApiError) return json(res, e.status, { error: e.message });
      console.error(e);
      if (!res.headersSent) json(res, 500, { error: 'internal error' });
      else res.end();
    });
  });
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
  fs.writeFileSync(tmp, JSON.stringify(value));
  if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`);
  fs.renameSync(tmp, file);
}
