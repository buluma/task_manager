#!/usr/bin/env node
/* gr8r: manage tasks on the sync server from the shell. See `gr8r help`. */
import { parseArgs } from 'node:util';

const BASE = (process.env.GR8R_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
const HELP = `usage: gr8r <command> [options]   (server: $GR8R_URL, default http://127.0.0.1:8787)

  list [--status S] [--priority P] [--project KEY] [--cycle current|none|DATE] [--query TEXT] [--archived]
  show KEY
  add TITLE [--project KEY] [--status S] [--priority P] [--due DATE] [--start DATE] [--cycle current|DATE]
            [--label L ...] [--desc TEXT] [--estimate E]
  set KEY [--title T] [--status S] [--priority P] [--due DATE|none] [--start DATE|none] [--cycle current|DATE|none]
          [--label L ... | --label none] [--desc TEXT] [--estimate E|none]
  done KEY            mark complete
  rm KEY              archive (restore it from the app's Archive page)
  projects

  status: backlog todo progress review done     priority: urgent high medium low none
  Add --json to any command for machine-readable output.`;

const OPTIONS = {
  status: { type: 'string' },
  priority: { type: 'string' },
  project: { type: 'string' },
  cycle: { type: 'string' },
  query: { type: 'string', short: 'q' },
  archived: { type: 'boolean' },
  title: { type: 'string' },
  due: { type: 'string' },
  start: { type: 'string' },
  label: { type: 'string', multiple: true },
  desc: { type: 'string' },
  estimate: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

class CliError extends Error {}

async function api(method, route, body) {
  let res;
  try {
    res = await fetch(BASE + route, { method, headers: body ? { 'content-type': 'application/json' } : {}, body: body && JSON.stringify(body) });
  } catch (e) {
    throw new CliError(`cannot reach ${BASE} (${e.cause?.code || e.message}). Set GR8R_URL to the server, e.g. http://100.x.y.z:8787`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CliError(data.error || `server answered ${res.status}`);
  return data;
}

/* "none" clears the fields that can be empty; for priority it is a real value. */
const CLEARABLE = ['due', 'start', 'cycle', 'estimate'];
function fields(v, keys) {
  const out = {};
  for (const k of keys) if (v[k] !== undefined) out[k] = CLEARABLE.includes(k) && v[k] === 'none' ? null : v[k];
  if (v.label) out.labels = v.label.length === 1 && v.label[0] === 'none' ? [] : v.label;
  return out;
}

const strip = html =>
  (html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const row = t =>
  `${t.key.padEnd(8)} ${t.status.padEnd(9)} ${t.priority.padEnd(7)} ${t.title}${t.cycle ? `  [cycle ${t.cycle}]` : ''}${t.archived ? '  [archived]' : ''}`;
function detail(t) {
  const lines = [
    `${t.key}  ${t.title}`,
    `status    ${t.status}`,
    `priority  ${t.priority}`,
    `due       ${t.due || '-'}`,
    `cycle     ${t.cycle || '-'}${t.carried ? `  (carried over ${t.carried}x)` : ''}`,
    `labels    ${t.labels.length ? t.labels.join(', ') : '-'}`,
  ];
  if (strip(t.desc)) lines.push('', strip(t.desc));
  return lines.join('\n');
}

async function main(argv) {
  const {
    values: v,
    positionals: [cmd, ...rest],
  } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (!cmd || cmd === 'help' || v.help) return console.log(HELP);
  const out = (data, text) => console.log(v.json ? JSON.stringify(data, null, 2) : text);
  const key = () => {
    if (rest.length !== 1) throw new CliError(`${cmd} needs exactly one task key`);
    return encodeURIComponent(rest[0]);
  };
  switch (cmd) {
    case 'list': {
      const q = new URLSearchParams();
      for (const [flag, name] of [
        ['status', 'status'],
        ['priority', 'priority'],
        ['project', 'project'],
        ['cycle', 'cycle'],
        ['query', 'q'],
      ])
        if (v[flag]) q.set(name, v[flag]);
      if (v.archived) q.set('archived', '1');
      const { tasks } = await api('GET', `/api/tasks?${q}`);
      return out(tasks, tasks.length ? tasks.map(row).join('\n') : 'no tasks');
    }
    case 'show': {
      const { task } = await api('GET', `/api/tasks/${key()}`);
      return out(task, detail(task));
    }
    case 'add': {
      if (rest.length < 1) throw new CliError('add needs a title');
      const body = { title: rest.join(' '), ...fields(v, ['project', 'status', 'priority', 'due', 'start', 'cycle', 'desc', 'estimate']) };
      const { task } = await api('POST', '/api/tasks', body);
      return out(task, `created ${task.key}  ${task.title}`);
    }
    case 'set': {
      const body = fields(v, ['title', 'status', 'priority', 'due', 'start', 'cycle', 'desc', 'estimate']);
      const { task } = await api('PATCH', `/api/tasks/${key()}`, body);
      return out(task, `updated ${task.key}  ${task.status}  ${task.title}`);
    }
    case 'done': {
      const { task } = await api('PATCH', `/api/tasks/${key()}`, { status: 'done' });
      return out(task, `done ${task.key}  ${task.title}`);
    }
    case 'rm': {
      const { task } = await api('DELETE', `/api/tasks/${key()}`);
      return out(task, `archived ${task.key}  ${task.title}`);
    }
    case 'projects': {
      const { projects } = await api('GET', '/api/projects');
      return out(projects, projects.map(p => `${p.key.padEnd(8)} ${p.name}`).join('\n'));
    }
    default:
      throw new CliError(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch(e => {
  console.error(e instanceof CliError || e.code?.startsWith('ERR_PARSE_ARGS') ? `error: ${e.message}` : e);
  process.exit(1);
});
