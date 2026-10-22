import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { hostList, listenAll } from './listen.js';

test('hostList reads one address or a comma-separated list, defaulting to loopback', () => {
  assert.deepEqual(hostList(undefined), ['127.0.0.1']);
  assert.deepEqual(hostList(''), ['127.0.0.1']);
  assert.deepEqual(hostList('100.100.245.3'), ['100.100.245.3']);
  assert.deepEqual(hostList(' 100.100.245.3 , 127.0.0.1 ,'), ['100.100.245.3', '127.0.0.1']);
});

test('listenAll serves one app on every address, so a write through one is read through the other', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gr8r-listen-'));
  const dataFile = path.join(dir, 'state.json');
  const state = { data: { me: 'm1', members: [{ id: 'm1', name: 'Me' }], projects: [], tasks: [] }, prefs: {} };
  fs.writeFileSync(dataFile, JSON.stringify({ rev: 1, state }));
  // The IPv4 and IPv6 loopbacks stand in for the Tailscale IP and 127.0.0.1.
  const servers = await listenAll(createApp({ dataFile, distDir: dir }), 0, ['127.0.0.1', '::1']);
  try {
    const url = ({ address, family, port }) => `http://${family === 'IPv6' ? `[${address}]` : address}:${port}`;
    const [a, b] = servers.map(s => url(s.address()));
    const put = await fetch(`${a}/api/state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ baseRev: 1, state }),
    });
    assert.equal(put.status, 200);
    assert.equal((await (await fetch(`${b}/api/rev`)).json()).rev, 2);
  } finally {
    await Promise.all(servers.map(s => new Promise(r => s.close(r))));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
