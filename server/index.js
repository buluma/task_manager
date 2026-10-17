import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

/* Defaults to loopback. For tailnet-only access set GR8R_HOST to this machine's Tailscale IP
   (`tailscale ip -4`); never 0.0.0.0, which would also expose it on the local network. */
const host = process.env.GR8R_HOST || '127.0.0.1';
const port = Number(process.env.GR8R_PORT) || 8787;
const dataFile = process.env.GR8R_DATA || path.join(os.homedir(), '.gr8r', 'state.json');
const distDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'dist');

createApp({ dataFile, distDir }).listen(port, host, () => console.log(`gr8r listening on http://${host}:${port}, data in ${dataFile}`));
