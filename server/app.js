/* Personal sync server: stores the whole app state as one JSON file and serves the built app.
   Revision numbers stop a stale tab or device from silently overwriting newer data. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { ApiError, archiveTask, createTask, findTask, listProjects, listTasks, localIso, patchTask } from './tasks.js';

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

export function createApp({ dataFile, distDir, now = () => new Date() }) {
  let current = readStored(dataFile);

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
    if (what === 'projects' && parts.length === 1) {
      allow('GET');
      return json(res, 200, { projects: listProjects(needState().data) });
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
    if (what === 'tasks' && parts.length === 2) {
      allow('GET', 'PATCH', 'DELETE');
      if (method === 'GET') return json(res, 200, { task: findTask(needState().data, key) });
      if (method === 'DELETE') return json(res, 200, { task: mutate((d, p, today, t) => archiveTask(d, key, t)) });
      const body = await readJson(req, 'task');
      return json(res, 200, { task: mutate((d, p, today, t) => patchTask(d, p, today, key, body, t)) });
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
