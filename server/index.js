import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { loadRepoEnv } from './env.js';
import { hostList, listenAll } from './listen.js';

loadRepoEnv();

/* Defaults to loopback. For tailnet access set GR8R_HOST to this machine's Tailscale IP (`tailscale ip -4`), or
   to a list with 127.0.0.1 as well when `tailscale serve` adds HTTPS in front (see listen.js); never 0.0.0.0, which
   would also expose it on the local network. */
const hosts = hostList(process.env.GR8R_HOST);
const port = Number(process.env.GR8R_PORT) || 8787;
const dataFile = process.env.GR8R_DATA || path.join(os.homedir(), '.gr8r', 'state.json');
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

const token = process.env.GR8R_TOKEN || undefined;
const githubToken = process.env.GR8R_GITHUB_TOKEN || undefined;

const app = createApp({ dataFile, distDir, token, githubToken });
await listenAll(app, port, hosts);

/* Tasks in Review move to Done when their linked PR merges (app.js). Open PRs are cached for 10 minutes (github.js),
   so checking more often than that would not see a merge any sooner. */
const PR_SYNC_MS = 10 * 60e3;
const syncPrs = () =>
  app
    .closeMergedReviews()
    .then(keys => keys.length && console.log(`PR merged: moved ${keys.join(', ')} to Done`))
    .catch(e => console.error(`PR sync failed: ${e.message}`));
setInterval(syncPrs, PR_SYNC_MS);
syncPrs();

console.log(`gr8r listening on ${hosts.map(h => `http://${h}:${port}`).join(' and ')}, data in ${dataFile}${token ? ', API token required' : ''}`);
