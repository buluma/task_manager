#!/usr/bin/env node
/* gr8r: manage tasks on the sync server from the shell. See `gr8r help`. */
import { parseArgs } from 'node:util';
import { loadRepoEnv } from '../server/env.js';

loadRepoEnv();

const TOKEN = process.env.GR8R_TOKEN;
/* The agent writes are attributed to: --as NAME, else $GR8R_AGENT, else the workspace owner. Set in main(). */
let AGENT;
const BASE = (process.env.GR8R_URL || 'http://127.0.0.1:8787').replace(/\/$/, '');
/* A host that silently drops packets would otherwise hang the CLI forever. */
const TIMEOUT_MS = Number(process.env.GR8R_TIMEOUT_MS) || 10000;
const HELP = `usage: gr8r <command> [options]   (server: $GR8R_URL, default http://127.0.0.1:8787; token: $GR8R_TOKEN)

  list [--status S] [--priority P] [--project KEY] [--cycle current|none|DATE] [--query TEXT] [--pr yes|no] [--archived]
  show KEY
  add TITLE [--project KEY] [--status S] [--priority P] [--due DATE] [--start DATE] [--cycle current|DATE]
            [--label L ...] [--desc TEXT [--markdown]] [--estimate E] [--completed DATE (done tasks)]
            [--recur Daily|Weekly|"Every 2 weeks"|Monthly]
  set KEY [--title T] [--project KEY] [--status S] [--priority P] [--due DATE|none] [--start DATE|none] [--cycle current|DATE|none]
          [--label L ... | --label none] [--desc TEXT [--markdown]] [--estimate E|none] [--completed DATE|none] [--recur ...|none]
  done KEY            mark complete
  rm KEY              archive            restore KEY    bring an archived task back
  rm KEY --purge      delete an archived task for good
  subtask add KEY TITLE        subtask done|reopen|rm KEY SUBTASK_ID
  deps KEY                     dep add|rm KEY OTHER_KEY   (KEY waits for OTHER_KEY)
  comments KEY
  comment KEY TEXT [--at DATE]   add a comment (--at backdates it)
  comment edit KEY COMMENT_ID TEXT   replace a comment's text (keeps its author and date)
  comment rm KEY COMMENT_ID
  pr link KEY URL                record a GitHub PR on a task (a comment; linking twice is a no-op)
  projects [--archived]
  project show KEY
  project add NAME [--key KEY] [--desc TEXT] [--color C] [--icon I] [--status S] [--due DATE] [--lead MEMBER]
  project set KEY [--name N] [--desc TEXT] [--color C] [--icon I] [--status S] [--due DATE|none] [--lead MEMBER]
  project rm KEY      archive          project restore KEY    bring it back
  project rm KEY --purge    delete an archived project and its tasks for good
  notify TEXT [--task KEY] [--snippet TEXT] [--type needs|comment|update|mention|assign]   raise an Inbox item (use with --as; needs = asking for you)
  inbox [--unread]               list Inbox items      inbox read|unread ID   mark one
  agent add NAME                 register an agent, so its writes show under its own name
  agent list
  members                        member add EMAIL... [--role Admin|Member|Guest] [--team T]
  member set ID|EMAIL [--name N] [--title T] [--role R] [--team T|none]      member rm ID|EMAIL
  teams                          team add NAME [--desc TEXT] [--icon I] [--color C] [--member ID ...]
  team set ID|NAME [--name N] [--desc TEXT] [--icon I] [--color C] [--member ID ... | --member none]   team rm ID|NAME
  milestones KEY                 milestone add KEY NAME --date DATE
  milestone set KEY NAME [--name N] [--date DATE]                            milestone rm KEY NAME
  labels                         label add NAME [--color C]     label set ID [--name N] [--color C]     label rm ID
  priorities
  priority add NAME --weight 1-99 [--id ID]
  priority set ID [--name N] [--weight 1-99]
  priority rm ID [--replace ID]    tasks on it move to ID (default none)

  status: backlog todo progress review done cancelled     priority: see \`gr8r priorities\` (default urgent high medium low none)
  project status: planning active risk hold complete
  --as NAME (or $GR8R_AGENT) on any command logs the write to that agent instead of you.
  Add --json to any command for machine-readable output.`;

const OPTIONS = {
  status: { type: 'string' },
  priority: { type: 'string' },
  project: { type: 'string' },
  cycle: { type: 'string' },
  query: { type: 'string', short: 'q' },
  archived: { type: 'boolean' },
  pr: { type: 'string' },
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
  as: { type: 'string' },
  task: { type: 'string' },
  snippet: { type: 'string' },
  type: { type: 'string' },
  unread: { type: 'boolean' },
  name: { type: 'string' },
  key: { type: 'string' },
  color: { type: 'string' },
  icon: { type: 'string' },
  lead: { type: 'string' },
  weight: { type: 'string' },
  id: { type: 'string' },
  replace: { type: 'string' },
  role: { type: 'string' },
  team: { type: 'string' },
  member: { type: 'string', multiple: true },
  date: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
};

class CliError extends Error {}

const PR_URL = /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/pull\/\d+$/;

async function api(method, route, body) {
  let res;
  try {
    res = await fetch(BASE + route, {
      method,
      headers: {
        ...(body && { 'content-type': 'application/json' }),
        ...(TOKEN && { authorization: `Bearer ${TOKEN}` }),
        ...(AGENT && { 'x-gr8r-agent': AGENT }),
      },
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
const memberRow = m => `${m.id.padEnd(16)} ${(m.role || '').padEnd(7)} ${m.name}${m.email ? `  <${m.email}>` : ''}${m.team ? `  [${m.team}]` : ''}`;
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
  if (t.subtasks?.length) lines.push('', 'subtasks', ...t.subtasks.map(s => `${s.done ? '[x]' : '[ ]'} ${s.title}  (${s.id})`));
  return lines.join('\n');
}

async function main(argv) {
  const {
    values: v,
    positionals: [cmd, ...rest],
  } = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  if (!cmd || cmd === 'help' || v.help) return console.log(HELP);
  AGENT = v.as ?? process.env.GR8R_AGENT;
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
        ['pr', 'pr'],
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
    case 'restore': {
      const { task } = await api('PATCH', `/api/tasks/${key()}`, { archived: false });
      return out(task, `restored ${task.key}  ${task.title}`);
    }
    case 'subtask': {
      const [sub, taskKey, ...tail] = rest;
      const enc = encodeURIComponent;
      if (sub === 'add') {
        if (!taskKey || !tail.length) throw new CliError('subtask add needs a task key and a title');
        const { subtask } = await api('POST', `/api/tasks/${enc(taskKey)}/subtasks`, { title: tail.join(' ') });
        return out(subtask, `added subtask ${subtask.id} to ${taskKey.toUpperCase()}  ${subtask.title}`);
      }
      if (!['done', 'reopen', 'rm'].includes(sub)) throw new CliError(`unknown subtask command: ${sub ?? '(none)'}\n\n${HELP}`);
      if (!taskKey || tail.length !== 1) throw new CliError(`subtask ${sub} needs a task key and a subtask id`);
      const route = `/api/tasks/${enc(taskKey)}/subtasks/${enc(tail[0])}`;
      const { subtask } = sub === 'rm' ? await api('DELETE', route) : await api('PATCH', route, { done: sub === 'done' });
      return out(subtask, `${sub === 'rm' ? 'removed' : sub === 'done' ? 'completed' : 'reopened'} subtask ${subtask.id}  ${subtask.title}`);
    }
    case 'deps': {
      const { deps } = await api('GET', `/api/tasks/${key()}/deps`);
      return out(deps, deps.length ? deps.map(d => `${d.key.padEnd(8)} ${d.status.padEnd(9)} ${d.title}`).join('\n') : 'no dependencies');
    }
    case 'dep': {
      const [sub, taskKey, otherKey] = rest;
      if (!['add', 'rm'].includes(sub)) throw new CliError(`unknown dep command: ${sub ?? '(none)'}\n\n${HELP}`);
      if (!taskKey || !otherKey || rest.length !== 3) throw new CliError(`dep ${sub} needs two task keys`);
      const enc = encodeURIComponent;
      const { deps } =
        sub === 'add'
          ? await api('POST', `/api/tasks/${enc(taskKey)}/deps`, { on: otherKey })
          : await api('DELETE', `/api/tasks/${enc(taskKey)}/deps/${enc(otherKey)}`);
      return out(
        deps,
        `${taskKey.toUpperCase()} ${sub === 'add' ? 'now waits for' : 'no longer waits for'} ${otherKey.toUpperCase()} (${deps.length} dependenc${deps.length === 1 ? 'y' : 'ies'})`,
      );
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
      if (rest[0] === 'edit') {
        if (rest.length < 4) throw new CliError('comment edit needs a task key, a comment id and the new text');
        const [, taskKey, id, ...words] = rest;
        const route = `/api/tasks/${encodeURIComponent(taskKey)}/comments/${encodeURIComponent(id)}`;
        const { comment } = await api('PATCH', route, { text: words.join(' ') });
        return out(comment, `edited comment ${comment.id} on ${taskKey.toUpperCase()}`);
      }
      if (rest.length < 2) throw new CliError('comment needs a task key and some text');
      const [taskKey, ...words] = rest;
      const { comment } = await api('POST', `/api/tasks/${encodeURIComponent(taskKey)}/comments`, { text: words.join(' '), ...(v.at && { at: v.at }) });
      return out(comment, `commented on ${taskKey.toUpperCase()}  ${comment.id}`);
    }
    case 'pr': {
      if (rest[0] !== 'link') throw new CliError(`unknown pr command: ${rest[0] ?? '(none)'}\n\n${HELP}`);
      if (rest.length !== 3) throw new CliError('pr link needs a task key and a PR url');
      const [, taskKey, prUrl] = rest;
      if (!PR_URL.test(prUrl)) throw new CliError('not a GitHub PR url (https://github.com/OWNER/REPO/pull/N)');
      const route = `/api/tasks/${encodeURIComponent(taskKey)}/comments`;
      const text = `PR: ${prUrl}`;
      const { comments } = await api('GET', route);
      const existing = comments.find(c => c.text === text);
      if (existing) return out(existing, `${prUrl} is already linked to ${taskKey.toUpperCase()}`);
      const { comment } = await api('POST', route, { text });
      return out(comment, `linked ${taskKey.toUpperCase()}  ${prUrl}`);
    }
    case 'notify': {
      if (!rest.length) throw new CliError('notify needs some text');
      const body = { text: rest.join(' '), ...(v.task && { task: v.task }), ...(v.snippet && { snippet: v.snippet }), ...(v.type && { type: v.type }) };
      const { notification } = await api('POST', '/api/notifications', body);
      return out(notification, `notified  ${notification.id}`);
    }
    case 'inbox': {
      const [sub, id, ...extra] = rest;
      if (sub !== undefined) {
        if (!['read', 'unread'].includes(sub) || !id || extra.length) throw new CliError(`inbox needs: (nothing) | read ID | unread ID\n\n${HELP}`);
        const { notification } = await api('PATCH', `/api/notifications/${encodeURIComponent(id)}`, { read: sub === 'read' });
        return out(notification, `marked ${id} ${sub}`);
      }
      const { notifications } = await api('GET', `/api/notifications${v.unread ? '?unread=1' : ''}`);
      const line = n => `${n.read ? ' ' : '*'} ${n.id.padEnd(9)} ${(n.from || '-').padEnd(10)} ${n.text.padEnd(16)} ${(n.key || '-').padEnd(8)} ${n.snippet}`;
      return out(notifications, notifications.length ? notifications.map(line).join('\n') : 'inbox is empty');
    }
    case 'agent': {
      const [sub, ...args] = rest;
      if (sub === 'list' && !args.length) {
        const { agents } = await api('GET', '/api/agents');
        return out(agents, agents.length ? agents.map(a => `${a.id.padEnd(16)} ${a.name}`).join('\n') : 'no agents');
      }
      if (sub === 'add' && args.length) {
        const { agent } = await api('POST', '/api/agents', { name: args.join(' ') });
        return out(agent, `added agent ${agent.name}  ${agent.id}`);
      }
      throw new CliError(`agent needs: add NAME | list\n\n${HELP}`);
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
    case 'members': {
      const { members } = await api('GET', '/api/members');
      return out(members, members.map(memberRow).join('\n'));
    }
    case 'member': {
      const [sub, ...args] = rest;
      const one = () => {
        if (args.length !== 1) throw new CliError(`member ${sub} needs exactly one member id or email`);
        return encodeURIComponent(args[0]);
      };
      const team = v.team === undefined ? {} : { team: v.team === 'none' ? null : v.team };
      switch (sub) {
        case 'add': {
          if (!args.length) throw new CliError('member add needs one or more email addresses');
          const { members } = await api('POST', '/api/members', { emails: args, ...(v.role && { role: v.role }), ...team });
          return out(members, members.length ? members.map(m => `added ${memberRow(m)}`).join('\n') : 'already members: nothing added');
        }
        case 'set': {
          const { member } = await api('PATCH', `/api/members/${one()}`, { ...fields(v, ['name', 'title', 'role']), ...team });
          return out(member, `updated ${memberRow(member)}`);
        }
        case 'rm': {
          const { member } = await api('DELETE', `/api/members/${one()}`);
          return out(member, `removed ${member.name}`);
        }
        default:
          throw new CliError(`unknown member command: ${sub ?? '(none)'}\n\n${HELP}`);
      }
    }
    case 'teams': {
      const { teams } = await api('GET', '/api/teams');
      return out(teams, teams.map(t => `${t.id.padEnd(12)} ${t.name}`).join('\n'));
    }
    case 'team': {
      const [sub, ...args] = rest;
      const one = () => {
        if (args.length !== 1) throw new CliError(`team ${sub} needs exactly one team id or name (quote a name with spaces)`);
        return encodeURIComponent(args[0]);
      };
      const body = () => ({
        ...fields(v, ['name', 'desc', 'icon', 'color']),
        ...(v.member && { members: v.member.length === 1 && v.member[0] === 'none' ? [] : v.member }),
      });
      switch (sub) {
        case 'add': {
          if (!args.length) throw new CliError('team add needs a name');
          const { team } = await api('POST', '/api/teams', { ...body(), name: args.join(' ') });
          return out(team, `created ${team.id}  ${team.name}`);
        }
        case 'set': {
          const { team } = await api('PATCH', `/api/teams/${one()}`, body());
          return out(team, `updated ${team.id}  ${team.name}`);
        }
        case 'rm': {
          const { team } = await api('DELETE', `/api/teams/${one()}`);
          return out(team, `deleted ${team.name} (its members and projects are kept, with no team)`);
        }
        default:
          throw new CliError(`unknown team command: ${sub ?? '(none)'}\n\n${HELP}`);
      }
    }
    case 'milestones': {
      if (rest.length !== 1) throw new CliError('milestones needs a project key');
      const { milestones } = await api('GET', `/api/projects/${encodeURIComponent(rest[0])}/milestones`);
      return out(milestones, milestones.length ? milestones.map(m => `${m.date}  ${m.name}`).join('\n') : 'no milestones');
    }
    case 'milestone': {
      const [sub, projectKey, ...name] = rest;
      if (!projectKey || !name.length) throw new CliError(`milestone ${sub ?? ''} needs a project key and a milestone name`);
      const route = `/api/projects/${encodeURIComponent(projectKey)}/milestones`;
      const named = `${route}/${encodeURIComponent(name.join(' '))}`;
      switch (sub) {
        case 'add': {
          const { milestone } = await api('POST', route, { name: name.join(' '), date: v.date });
          return out(milestone, `added ${milestone.date}  ${milestone.name}`);
        }
        case 'set': {
          const { milestone } = await api('PATCH', named, fields(v, ['name', 'date']));
          return out(milestone, `updated ${milestone.date}  ${milestone.name}`);
        }
        case 'rm': {
          const { milestone } = await api('DELETE', named);
          return out(milestone, `removed ${milestone.name}`);
        }
        default:
          throw new CliError(`unknown milestone command: ${sub ?? '(none)'}\n\n${HELP}`);
      }
    }
    case 'labels': {
      const { labels } = await api('GET', '/api/labels');
      return out(labels, labels.map(l => `${l.id.padEnd(16)} ${l.color.padEnd(7)} ${l.name}  (${l.tasks} task${l.tasks === 1 ? '' : 's'})`).join('\n'));
    }
    case 'label': {
      const [sub, ...args] = rest;
      const id = () => {
        if (args.length !== 1) throw new CliError(`label ${sub} needs exactly one label id (quote one with spaces)`);
        return encodeURIComponent(args[0]);
      };
      switch (sub) {
        case 'add': {
          if (!args.length) throw new CliError('label add needs a name');
          const { label } = await api('POST', '/api/labels', { name: args.join(' '), ...fields(v, ['color']) });
          return out(label, `added ${label.name}  ${label.color}`);
        }
        case 'set': {
          const { label } = await api('PATCH', `/api/labels/${id()}`, fields(v, ['name', 'color']));
          return out(label, `updated ${label.id}  ${label.color}  ${label.name}`);
        }
        case 'rm': {
          const res = await api('DELETE', `/api/labels/${id()}`);
          return out(res, `removed the label from ${res.removed} task${res.removed === 1 ? '' : 's'}`);
        }
        default:
          throw new CliError(`unknown label command: ${sub ?? '(none)'}\n\n${HELP}`);
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
