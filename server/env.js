/* Reads KEY=VALUE lines from a .env file (gitignored) into process.env, so the token can live next to the
   code instead of in shell history. Variables already set in the environment win. No dependency, because
   process.loadEnvFile needs Node 20.12+ and the project supports 18. */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadEnv(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return;
    throw e;
  }
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m || line.trim().startsWith('#')) continue;
    const value = m[2].replace(/^(["'])(.*)\1$/, '$2');
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}

/* The repo's .env, or the file named by GR8R_ENV_FILE (empty: load nothing). Used by the server and the CLI. */
export function loadRepoEnv() {
  const file = 'GR8R_ENV_FILE' in process.env ? process.env.GR8R_ENV_FILE : fileURLToPath(new URL('../.env', import.meta.url));
  if (file) loadEnv(file);
}
