#!/usr/bin/env node
/* gr8r: manage tasks on the sync server from the shell. See `gr8r help`. */
import { parseArgs } from 'node:util';
import { loadRepoEnv } from '../server/env.js';

loadRepoEnv();

const TOKEN = process.env.GR8R_TOKEN;
const BASE = (process.env.GR8R_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
/* A host that silently drops packets would otherwise hang the CLI forever. */
const TIMEOUT_MS = Number(process.env.GR8R_TIMEOUT_MS) || 10000;
const HELP = `usage: gr8r <command> [options]   (server: $GR8R_URL, default http://127.0.0.1:8787; token: $GR8R_TOKEN)

  list [--status S] [--priority P] [--project KEY] [--cycle current|none|DATE] [--query TEXT] [--archived]
  show KEY
  add TITLE [--project KEY] [--status S] [--priority P] [--due DATE] [--start DATE] [--cycle current|DATE]
            [--label L ...] [--desc TEXT [--markdown]] [--estimate E] [--completed DATE (done tasks)]
            [--recur Daily|Weekly|"Every 2 weeks"|Monthly]
  set KEY [--title T] [--project KEY] [--status S] [--priority P] [--due DATE|none] [--start DATE|none] [--cycle current|DATE|none]
          [--label L ... | --label none] [--desc TEXT [--markdown]] [--estimate E|none] [--completed DATE|none] [--recur ...|none]
  done KEY            mark complete
  rm KEY              archive (restore it from the app's Archive page)
  rm KEY --purge      delete an archived task for good
  comments KEY
  comment KEY TEXT [--at DATE]   add a comment (--at backdates it)
  comment rm KEY COMMENT_ID
  projects [--archived]
  project show KEY
  project add NAME [--key KEY] [--desc TEXT] [--color C] [--icon I] [--status S] [--due DATE] [--lead MEMBER]
  project set KEY [--name N] [--desc TEXT] [--color C] [--icon I] [--status S] [--due DATE|none] [--lead MEMBER]
  project rm KEY      archive          project restore KEY    bring it back
  project rm KEY --purge    delete an archived project and its tasks for good
  priorities
  priority add NAME --weight 1-99 [--id ID]
  priority set ID [--name N] [--weight 1-99]
  priority rm ID [--replace ID]    tasks on it move to ID (default none)

  status: backlog todo progress review done     priority: see \`gr8r priorities\` (default urgent high medium low none)
  project status: planning active risk hold complete
  Add --json to any command for machine-readable output.`;

const OPTIONS = {
  status: { type: 'string' },
  priority: { type: 'string' },
  project: { type: 'string' },
  cycle: { type: 'string' },
  query: { type: 'string', short: 'q' },
  archived: { type: 'boolean' },
  purge: { type: 'boolean' },
  markdown: { type: 'boolean' },
  title: { type: 'string' },
  due: { type: 'string' },
  start: { type: 'string' },
  label: { type: 'string', multiple: true },
  desc: { type: 'string' },
  estimate: { type: 'string' },
  completed: { type: 'string' },
  recur: { type: 'string' },
  at: { type: 'string' },
  name: { type: 'string' },
  key: { type: 'string' },
  color: { type: 'string' },
  icon: { type: 'string' },
  lead: { type: 'string' },
  weight: { type: 'string' },
  id: { type: 'string' },
  replace: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

class CliError extends Error {}

async function api(method, route, body) {
  let res;
  try {
    res = await fetch(BASE + route, {
      method,
      headers: { ...(body && { 'content-type': 'application/json' }), ...(TOKEN && { authorization: `Bearer ${TOKEN}` }) },
      body: body && JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (e) {
    if (e.name === 'TimeoutError') throw new CliError(`${BASE} did not answer within ${TIMEOUT_MS / 1000}s. Check GR8R_URL and that the server is running`);
    throw new CliError(`cannot reach ${BASE} (${e.cause?.code || e.cause?.message || e.message}). Set GR8R_URL to the server, e.g. http://100.x.y.z:8787`);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new CliError(data.error || `server answered ${res.status}`);
  return data;
}

/* "none" clears the fields that can be empty; for priority it is a real value. */
const CLEARABLE = ['due', 'start', 'cycle', 'estimate', 'completed', 'recur'];
function fields(v, keys) {
  const out = {};
  for (const k of keys) if (v[k] !== undefined) out[k] = CLEARABLE.includes(k) && v[k] === 'none' ? null : v[k];
  if (v.markdown && out.desc !== undefined) out.descFormat = 'markdown';
  if (v.label) out.labels = v.label.length === 1 && v.label[0] === 'none' ? [] : v.label;
  return out;
}

/* Descriptions are small HTML: keep paragraph and line breaks, drop the tags, decode the entities the server writes. */
const strip = html =>
  (html || '')
    .replace(/<li>/g, '\n• ')
    .replace(/<\/(?:p|h[1-6]|pre|blockquote|ul|ol)>/g, '\n\n')
    .replace(/<hr>/g, '\n---\n')
    .replace(/<br\s*\/?>/g, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
const projectRow = p => `${p.key.padEnd(8)} ${p.name}${p.archived ? '  [archived]' : ''}`;
const prioRow = p => `${p.id.padEnd(10)} ${String(p.w).padEnd(3)} ${p.name.padEnd(12)} ${p.tasks} task${p.tasks === 1 ? '' : 's'}`;
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
      const body = {
        title: rest.join(' '),
        ...fields(v, ['project', 'status', 'priority', 'due', 'start', 'cycle', 'desc', 'estimate', 'completed', 'recur']),
      };
      const { task } = await api('POST', '/api/tasks', body);
      return out(task, `created ${task.key}  ${task.title}`);
    }
    case 'set': {
      const body = fields(v, ['title', 'project', 'status', 'priority', 'due', 'start', 'cycle', 'desc', 'estimate', 'completed', 'recur']);
      const { task } = await api('PATCH', `/api/tasks/${key()}`, body);
      return out(task, `updated ${task.key}  ${task.status}  ${task.title}`);
    }
    case 'done': {
      const { task, next } = await api('PATCH', `/api/tasks/${key()}`, { status: 'done' });
      return out(task, `done ${task.key}  ${task.title}${next ? `\nnext ${next.key}  due ${next.due}` : ''}`);
    }
    case 'rm': {
      const { task } = await api('DELETE', `/api/tasks/${key()}${v.purge ? '?purge=1' : ''}`);
      return out(task, `${v.purge ? 'deleted' : 'archived'} ${task.key}  ${task.title}`);
    }
    case 'comments': {
      const { comments } = await api('GET', `/api/tasks/${key()}/comments`);
      const when = at => new Date(at).toISOString().slice(0, 16).replace('T', ' ');
      return out(comments, comments.length ? comments.map(c => `${when(c.at)}  ${c.id}\n${c.text}`).join('\n\n') : 'no comments');
    }
    case 'comment': {
      if (rest[0] === 'rm') {
        if (rest.length !== 3) throw new CliError('comment rm needs a task key and a comment id');
        const { comment } = await api('DELETE', `/api/tasks/${encodeURIComponent(rest[1])}/comments/${encodeURIComponent(rest[2])}`);
        return out(comment, `deleted comment ${comment.id}`);
      }
      if (rest.length < 2) throw new CliError('comment needs a task key and some text');
      const [taskKey, ...words] = rest;
      const { comment } = await api('POST', `/api/tasks/${encodeURIComponent(taskKey)}/comments`, { text: words.join(' '), ...(v.at && { at: v.at }) });
      return out(comment, `commented on ${taskKey.toUpperCase()}  ${comment.id}`);
    }
    case 'projects': {
      const { projects } = await api('GET', `/api/projects${v.archived ? '?archived=1' : ''}`);
      return out(projects, projects.map(projectRow).join('\n'));
    }
    case 'project': {
      const [sub, ...args] = rest;
      const one = () => {
        if (args.length !== 1) throw new CliError(`project ${sub} needs exactly one project key`);
        return encodeURIComponent(args[0]);
      };
      const body = () => fields(v, ['name', 'desc', 'status', 'color', 'icon', 'due', 'lead']);
      switch (sub) {
        case 'show': {
          const { project } = await api('GET', `/api/projects/${one()}`);
          return out(project, [projectRow(project), project.desc && `\n${project.desc}`].filter(Boolean).join('\n'));
        }
        case 'add': {
          if (!args.length) throw new CliError('project add needs a name');
          const { project } = await api('POST', '/api/projects', { name: args.join(' '), ...(v.key && { key: v.key }), ...body() });
          return out(project, `created ${project.key}  ${project.name}`);
        }
        case 'set': {
          const { project } = await api('PATCH', `/api/projects/${one()}`, { ...(v.key && { key: v.key }), ...body() });
          return out(project, `updated ${project.key}  ${project.name}`);
        }
        case 'rm': {
          const res = await api('DELETE', `/api/projects/${one()}${v.purge ? '?purge=1' : ''}`);
          const { project } = res;
          if (!v.purge) return out(project, `archived ${project.key}  ${project.name}`);
          return out(res, `deleted ${project.key}  ${project.name} (${res.tasks} task${res.tasks === 1 ? '' : 's'})`);
        }
        case 'restore': {
          const { project } = await api('PATCH', `/api/projects/${one()}`, { archived: false });
          return out(project, `restored ${project.key}  ${project.name}`);
        }
        default:
          throw new CliError(`unknown project command: ${sub ?? '(none)'}\n\n${HELP}`);
      }
    }
    case 'priorities': {
      const { priorities } = await api('GET', '/api/priorities');
      return out(priorities, priorities.map(prioRow).join('\n'));
    }
    case 'priority': {
      const [sub, ...args] = rest;
      const weight = v.weight === undefined ? {} : { w: Number(v.weight) };
      const one = () => {
        if (args.length !== 1) throw new CliError(`priority ${sub} needs exactly one priority id`);
        return encodeURIComponent(args[0]);
      };
      switch (sub) {
        case 'add': {
          if (!args.length) throw new CliError('priority add needs a name');
          const { priority } = await api('POST', '/api/priorities', { name: args.join(' '), ...(v.id && { id: v.id }), ...weight });
          return out(priority, `created ${priority.id}  ${priority.w}  ${priority.name}`);
        }
        case 'set': {
          const { priority } = await api('PATCH', `/api/priorities/${one()}`, { ...(v.name && { name: v.name }), ...weight });
          return out(priority, `updated ${priority.id}  ${priority.w}  ${priority.name}`);
        }
        case 'rm': {
          const { moved } = await api('DELETE', `/api/priorities/${one()}${v.replace ? `?replace=${encodeURIComponent(v.replace)}` : ''}`);
          return out({ moved }, `deleted ${args[0]}, moved ${moved} task${moved === 1 ? '' : 's'} to ${v.replace || 'none'}`);
        }
        default:
          throw new CliError(`unknown priority command: ${sub ?? '(none)'}\n\n${HELP}`);
      }
    }
    default:
      throw new CliError(`unknown command: ${cmd}\n\n${HELP}`);
  }
}

main(process.argv.slice(2)).catch(e => {
  console.error(e instanceof CliError || e.code?.startsWith('ERR_PARSE_ARGS') ? `error: ${e.message}` : e);
  process.exit(1);
});
