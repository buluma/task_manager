/* Personal sync server: stores the whole app state as one JSON file and serves the built app.
   Revision numbers stop a stale tab or device from silently overwriting newer data. */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

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

export function createApp({ dataFile, distDir }) {
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

  async function handleState(req, res) {
    if (req.method === 'GET') {
      if (!current) return json(res, 404, { error: 'no state saved yet' });
      return json(res, 200, current);
    }
    if (req.method !== 'PUT') {
      res.setHeader('allow', 'GET, PUT');
      return json(res, 405, { error: 'method not allowed' });
    }
    if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return json(res, 403, { error: 'cross-origin write refused' });
    if (!/^application\/json\b/.test(req.headers['content-type'] || '')) return json(res, 415, { error: 'content-type must be application/json' });
    let body;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      if (e.status === 413) return json(res, 413, { error: 'state too large' });
      return json(res, 400, { error: 'invalid JSON' });
    }
    if (!Number.isInteger(body?.baseRev) || !body?.state?.data?.tasks)
      return json(res, 400, { error: 'expected { baseRev: integer, state: { data: { tasks } } }' });
    const rev = current?.rev ?? 0;
    if (body.baseRev !== rev) return json(res, 409, { rev });
    current = { rev: rev + 1, state: body.state };
    writeStored(dataFile, current);
    return json(res, 200, { rev: current.rev });
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
    const route = new URL(req.url, 'http://x').pathname === '/api/state' ? handleState : handleStatic;
    Promise.resolve(route(req, res)).catch(e => {
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
