/* The server re-implements the app's task actions (see the headers of tasks.js). These tests run the same change
   through both, on the same state at the same moment, and compare the results, so the two cannot drift apart
   without a test failing. The app side is the real code: createTask, applyPatch and deleteTasks, and the subtask
   handlers in the action tables, loaded by app-harness.js. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { app, fields, S, task, emptyWorkspace } from './app-harness.js';
import { archiveTask, createTask, patchTask, purgeTask } from './tasks.js';
import { addComment, deleteComment } from './comments.js';
import { archiveProject, createProject, patchProject, purgeProject } from './projects.js';
import { addDep, addSubtask, deleteSubtask, patchSubtask, removeDep } from './relations.js';
import { createMembers, createTeam, deleteMember, deleteTeam, patchTeam } from './people.js';
import { changeLabel, createLabel, deleteLabel } from './labels.js';
import { TEAMS_SEED } from '../src/core/constants.js';

const NOW = new Date(2026, 9, 18, 9, 0).getTime();
const TODAY = '2026-10-18';
const PREFS = { weekStart: 1 };

// A real workspace underneath, so the handlers that re-render have everything the shell draws. Teams are given up
// front because rendering seeds them on first use (teamsList in store.js).
const fixture = () => ({
  ...emptyWorkspace(),
  teams: TEAMS_SEED.map(t => ({ ...t })),
  me: 'm1',
  members: [
    { ...emptyWorkspace().members[0], id: 'm1', name: 'Me' },
    { ...emptyWorkspace().members[0], id: 'm2', name: 'Ada', role: 'Member' },
  ],
  projects: [
    { ...emptyWorkspace().projects[0], id: 'p1', key: 'GR', name: 'Tasks', seq: 2 },
    { ...emptyWorkspace().projects[0], id: 'p2', key: 'OPS', name: 'Ops', seq: 7 },
  ],
  projOrder: ['p1', 'p2'],
  tasks: [
    {
      id: 't1',
      key: 'GR-1',
      project: 'p1',
      title: 'Write the report',
      status: 'todo',
      assignee: 'm1',
      priority: 'none',
      due: '2026-10-20',
      start: null,
      labels: [],
      subtasks: [{ id: 's1', title: 'Outline', done: true }],
      deps: [],
      desc: '',
      estimate: null,
      cycle: null,
      fav: false,
      recur: null,
      created: 1,
      updated: 1,
      order: 1,
    },
    {
      id: 't2',
      key: 'GR-2',
      project: 'p1',
      title: 'Send it',
      status: 'backlog',
      assignee: null,
      priority: 'high',
      due: null,
      start: null,
      labels: ['ops'],
      subtasks: [],
      deps: ['t1'],
      desc: '',
      estimate: null,
      cycle: null,
      fav: false,
      recur: null,
      created: 2,
      updated: 2,
      order: 2,
    },
  ],
  comments: [{ id: 'c1', task: 't1', by: 'm1', at: 3, text: 'First draft is up', re: {} }],
  activity: [],
  notifs: [],
});

/* Ids are random on both sides, so tasks are compared by key, and activity rows, subtasks and comments without their id. */
function normalize(data) {
  const keyOf = id => data.tasks.find(t => t.id === id)?.key ?? id;
  const without = (o, k) => {
    const c = { ...o };
    delete c[k];
    return c;
  };
  // New members and teams get random ids too: members are compared without theirs, and a team is named by its name.
  const teamOf = id => data.teams?.find(t => t.id === id)?.name ?? id;
  // So do new projects: a project is named by its key wherever it is referred to.
  const projectOf = id => data.projects.find(p => p.id === id)?.key ?? id;
  return {
    ...data,
    members: data.members.map(m => ({ ...without(m, 'id'), team: teamOf(m.team) })),
    teams: data.teams?.map(t => without(t, 'id')),
    projects: data.projects.map(p => ({ ...without(p, 'id'), team: teamOf(p.team) })),
    projOrder: data.projOrder.map(projectOf),
    tasks: data.tasks.map(t => ({
      ...without(t, 'id'),
      project: projectOf(t.project),
      deps: t.deps.map(keyOf),
      subtasks: t.subtasks.map(s => without(s, 'id')),
    })),
    comments: data.comments.map(c => ({ ...without(c, 'id'), task: keyOf(c.task) })),
    activity: data.activity.map(a => ({ ...without(a, 'id'), task: keyOf(a.task), project: projectOf(a.project) })),
  };
}

function viaApp(fn) {
  mock.timers.enable({ apis: ['Date'], now: NOW });
  try {
    S.data = fixture();
    fn();
    return normalize(S.data);
  } finally {
    mock.timers.reset();
  }
}
function viaServer(fn) {
  const data = fixture();
  fn(data);
  return normalize(data);
}

/* One field change, made in the app's task drawer and through PATCH /api/tasks/GR-1. */
const patchCase = (name, patch) =>
  test(`patch parity: ${name}`, () => {
    const a = viaApp(() => app.applyPatch(task('t1'), patch));
    const s = viaServer(d => patchTask(d, PREFS, TODAY, 'GR-1', patch, NOW));
    assert.deepEqual(s, a);
  });

patchCase('moving to another status', { status: 'progress' });
patchCase('completing', { status: 'done' });
patchCase('cancelling', { status: 'cancelled' });
patchCase('assigning', { assignee: 'm2' });
patchCase('unassigning', { assignee: null });
patchCase('changing priority', { priority: 'urgent' });
patchCase('clearing the due date', { due: null });
patchCase('clearing the start date', { start: null });
patchCase('renaming', { title: 'Write the final report' });
patchCase('setting labels', { labels: ['writing'] });
patchCase('estimating', { estimate: '3' });
patchCase('adding to a cycle', { cycle: '2026-10-12' });
patchCase('moving to another project', { project: 'p2' });
patchCase('setting the due date', { due: '2026-10-25' });
patchCase('setting the start date', { start: '2026-10-19' });
patchCase('setting a repeat', { recur: 'Weekly' });

test('patch parity: completing a repeating task schedules the next one', () => {
  const setup = d => Object.assign(d.tasks[0], { recur: 'Weekly' });
  const a = viaApp(() => {
    setup(S.data);
    app.applyPatch(task('t1'), { status: 'done' });
  });
  const s = viaServer(d => {
    setup(d);
    patchTask(d, PREFS, TODAY, 'GR-1', { status: 'done' }, NOW);
  });
  assert.deepEqual(s, a);
});

test('create parity: a task with every field given', () => {
  const fields = {
    title: 'Plan the launch',
    status: 'progress',
    assignee: 'm2',
    priority: 'medium',
    due: '2026-10-30',
    start: '2026-10-19',
    labels: ['launch'],
    estimate: '5',
    cycle: '2026-10-12',
    recur: null,
  };
  const a = viaApp(() => app.createTask({ ...fields, project: 'p2' }));
  const s = viaServer(d => createTask(d, PREFS, TODAY, { ...fields, project: 'OPS' }, NOW));
  assert.deepEqual(s, a);
});

/* An app handler against the API route that does the same thing. */
const handlerCase = (title, onApp, onServer, setup = () => {}) =>
  test(title, () => {
    const a = viaApp(() => {
      setup(S.data);
      onApp();
    });
    const s = viaServer(d => {
      setup(d);
      onServer(d);
    });
    assert.deepEqual(s, a);
  });

/* Subtasks: the drawer's handlers against the subtask routes. GR-1 starts with one done subtask, s1. */
const sub = { dataset: { id: 't1', sid: 's1' } };
const subCase = (name, ...rest) => handlerCase(`subtask parity: ${name}`, ...rest);

subCase(
  'adding',
  () => app.KEY.addSub({ dataset: { id: 't1' }, value: ' Draft ' }),
  d => addSubtask(d, 'GR-1', { title: ' Draft ' }, NOW),
);
subCase(
  'reopening',
  () => app.A.toggleSub(sub),
  d => patchSubtask(d, 'GR-1', 's1', { done: false }, NOW),
);
subCase(
  'completing',
  () => app.A.toggleSub(sub),
  d => patchSubtask(d, 'GR-1', 's1', { done: true }, NOW),
  d => (d.tasks[0].subtasks[0].done = false),
);
subCase(
  'renaming',
  () => app.BLUR.commitSubTitle({ ...sub, value: 'Outline v2' }),
  d => patchSubtask(d, 'GR-1', 's1', { title: 'Outline v2' }, NOW),
);
subCase(
  'deleting',
  () => app.A.rmSub(sub),
  d => deleteSubtask(d, 'GR-1', 's1', NOW),
);

/* Comments: the drawer's composer and delete button against the comment routes. GR-1 starts with one comment, c1. */
const commentCase = (name, ...rest) => handlerCase(`comment parity: ${name}`, ...rest);

commentCase(
  'posting',
  () => {
    S.ui.drafts.t1 = '  Looks good  ';
    app.A.postComment({ dataset: { id: 't1' } });
  },
  d => addComment(d, 'GR-1', { text: '  Looks good  ' }, NOW),
);
commentCase(
  'deleting',
  () => app.A.delComment({ dataset: { id: 'c1' } }),
  d => deleteComment(d, 'GR-1', 'c1'),
);

/* Archive: the app's archive, restore and delete buttons against the API. Confirm dialogs are answered by running
   the dialog the handler opened. */
const archiveCase = (name, ...rest) => handlerCase(`archive parity: ${name}`, ...rest);
const confirm = () => S.ui.modals.pop().run();
const archived = id => d =>
  Object.assign(
    d.projects.find(p => p.id === id),
    { archived: true, archivedAt: 5 },
  );

archiveCase(
  'archiving a task',
  () => app.A.archiveTask({ dataset: { id: 't1' } }),
  d => archiveTask(d, 'GR-1', NOW),
);
archiveCase(
  'archiving a project',
  () => {
    app.A.archiveProject({ dataset: { id: 'p2' } });
    confirm();
  },
  d => archiveProject(d, 'OPS', NOW),
);
archiveCase(
  'restoring a project',
  () => app.A.restoreProject({ dataset: { id: 'p2' } }),
  d => patchProject(d, 'OPS', { archived: false }, NOW),
  archived('p2'),
);
archiveCase(
  'deleting an archived project for good',
  () => {
    app.A.delProject({ dataset: { id: 'p1' } });
    confirm();
  },
  d => purgeProject(d, 'GR'),
  d => {
    archived('p1')(d);
    d.activity.push({ id: 'a1', by: 'm1', verb: 'created project', task: null, project: 'p1', at: 4, extra: '' });
  },
);
archiveCase(
  'deleting an archived task for good: its links and comments go too',
  () => {
    app.A.purgeTask({ dataset: { id: 't1' } });
    confirm();
  },
  d => purgeTask(d, 'GR-1'),
  d => Object.assign(d.tasks[0], { archived: true, archivedAt: 5 }),
);
archiveCase(
  'restoring a task',
  () => app.A.restoreTask({ dataset: { id: 't1' } }),
  d => patchTask(d, PREFS, TODAY, 'GR-1', { archived: false }, NOW),
  d => Object.assign(d.tasks[0], { archived: true, archivedAt: 5 }),
);

/* Members and teams: the members page and team dialog against the member and team routes. Me (m1) is the owner;
   Ada (m2) a member; both start in the product team. */
const peopleCase = (name, ...rest) => handlerCase(`people parity: ${name}`, ...rest);

test('people parity: adding members from the add member dialog', () => {
  Object.assign(fields, { '#inv-emails': { value: 'grace.hopper@navy.mil, lin@x.io' }, '#inv-role': { value: 'Admin' }, '#inv-team': { value: 'mkt' } });
  mock.timers.enable({ apis: ['Date', 'setTimeout'], now: NOW });
  let a;
  try {
    S.data = fixture();
    app.A.submitInvite();
    mock.timers.tick(600); // the dialog's loading delay
    a = normalize(S.data);
  } finally {
    mock.timers.reset();
  }
  const s = viaServer(d => createMembers(d, { emails: ['grace.hopper@navy.mil', 'lin@x.io'], role: 'Admin', team: 'mkt' }));
  assert.deepEqual(s, a);
});
peopleCase(
  'removing a member',
  () => {
    app.A.removeMember({ dataset: { id: 'm2' } });
    confirm();
  },
  d => deleteMember(d, 'm2'),
  d => Object.assign(d.tasks[1], { assignee: 'm2' }),
);
peopleCase(
  'creating a team with a member',
  () => {
    Object.assign(fields, { '#tm-name': { value: 'Ops' }, '#tm-desc': { value: '' } });
    S.ui.modals = [{ type: 'team' }];
    S.ui.tform = { name: '', desc: '', icon: 'server', color: 'green', members: ['m2'] };
    app.A.submitTeam();
  },
  d => createTeam(d, { name: 'Ops', icon: 'server', color: 'green', members: ['m2'] }),
);
peopleCase(
  'editing a team and its members',
  () => {
    Object.assign(fields, { '#tm-name': { value: 'Product & Design' }, '#tm-desc': { value: 'Ships' } });
    S.ui.modals = [{ type: 'team', edit: 'product' }];
    S.ui.tform = { name: '', desc: '', icon: 'target', color: 'amber', members: ['m1'] };
    app.A.submitTeam();
  },
  d => patchTeam(d, 'product', { name: 'Product & Design', desc: 'Ships', icon: 'target', color: 'amber', members: ['m1'] }),
);
peopleCase(
  'deleting a team',
  () => {
    app.A.delTeam({ dataset: { id: 'product' } });
    confirm();
  },
  d => deleteTeam(d, 'product'),
);

/* Dependencies: the dependency picker (updateTask with a new deps list) against the dependency routes. GR-2 starts
   out waiting for GR-1. */
const depCase = (name, ...rest) => handlerCase(`dependency parity: ${name}`, ...rest);
depCase(
  'adding',
  () => app.updateTask('t1', { deps: ['t2'] }),
  d => addDep(d, 'GR-1', { on: 'GR-2' }, NOW),
);
depCase(
  'removing',
  () => app.updateTask('t2', { deps: [] }),
  d => removeDep(d, 'GR-2', 'GR-1', NOW),
);

/* Projects: the project dialog and status menu against the project routes. OPS (p2) is led by me, in the product
   team. */
const projectCase = (name, ...rest) => handlerCase(`project parity: ${name}`, ...rest);
const { dOff } = await import('../src/core/utils.js');
const dialog = (edit, pform, name, desc, repo = '') => {
  Object.assign(fields, { '#p-name': { value: name }, '#p-desc': { value: desc }, '#p-repo': { value: repo } });
  S.ui.modals = [{ type: 'project', edit }];
  S.ui.pform = pform;
  app.A.submitProject();
};
projectCase(
  'creating a blank project',
  () => dialog(undefined, { icon: 'server', color: 'teal', team: 'product', lead: 'm2', due: '2026-12-01', tmpl: 'blank' }, 'Home Lab', 'Racks and cables'),
  d => createProject(d, dOff(0), { name: 'Home Lab', icon: 'server', color: 'teal', lead: 'm2', due: '2026-12-01', desc: 'Racks and cables' }, NOW),
  d => Object.assign(d.members[1], { team: 'product' }),
);
projectCase(
  'creating a project in the Work workspace',
  () =>
    dialog(undefined, { icon: 'server', color: 'teal', team: 'product', lead: 'm2', due: '2026-12-01', tmpl: 'blank', workspace: 'work' }, 'Portal', 'Client'),
  d => createProject(d, dOff(0), { name: 'Portal', icon: 'server', color: 'teal', lead: 'm2', due: '2026-12-01', desc: 'Client', workspace: 'work' }, NOW),
  d => Object.assign(d.members[1], { team: 'product' }),
);
projectCase(
  'moving a project to the Work workspace in its settings',
  () => {
    app.A.editProject({ dataset: { id: 'p2' } });
    const p = S.data.projects.find(x => x.id === 'p2');
    S.ui.pform.workspace = 'work';
    Object.assign(fields, { '#p-name': { value: p.name }, '#p-desc': { value: p.desc }, '#p-repo': { value: '' } });
    app.A.submitProject();
  },
  d => patchProject(d, 'OPS', { workspace: 'work' }, NOW),
);
projectCase(
  'creating a project linked to a repo',
  () =>
    dialog(
      undefined,
      { icon: 'server', color: 'teal', team: 'product', lead: 'm2', due: '2026-12-01', tmpl: 'blank' },
      'Home Lab',
      'Racks',
      'https://github.com/buluma/homelab',
    ),
  d =>
    createProject(d, dOff(0), { name: 'Home Lab', icon: 'server', color: 'teal', lead: 'm2', due: '2026-12-01', desc: 'Racks', repo: 'buluma/homelab' }, NOW),
  d => Object.assign(d.members[1], { team: 'product' }),
);
projectCase(
  'editing a project',
  () => dialog('p2', { icon: 'rocket', color: 'rose', team: 'product', lead: 'm2', due: '2026-11-15' }, 'Operations', 'Keeps it running'),
  d => patchProject(d, 'OPS', { name: 'Operations', desc: 'Keeps it running', icon: 'rocket', color: 'rose', lead: 'm2', due: '2026-11-15' }, NOW),
);
projectCase(
  'linking a project to a repo in its settings',
  () => {
    app.A.editProject({ dataset: { id: 'p2' } });
    const p = S.data.projects.find(x => x.id === 'p2');
    Object.assign(fields, { '#p-name': { value: p.name }, '#p-desc': { value: p.desc }, '#p-repo': { value: 'buluma/ops' } });
    app.A.submitProject();
  },
  d => patchProject(d, 'OPS', { repo: 'buluma/ops' }, NOW),
);
projectCase(
  'changing status from the status menu',
  () => {
    S.ui.pop = { type: 'pstatus', id: 'p2' };
    app.A.popPick({ dataset: { v: 'risk' } });
  },
  d => patchProject(d, 'OPS', { status: 'risk' }, NOW),
);

/* Labels: Settings › Labels against the label routes. GR-2 is labelled "ops", a label typed straight onto it. */
const labelCase = (name, ...rest) => handlerCase(`label parity: ${name}`, ...rest);
labelCase(
  'adding',
  () => {
    Object.assign(fields, { '#label-name': { value: 'Chore' }, '#label-color': { value: 'teal' } });
    app.A.addLabel();
  },
  d => createLabel(d, { name: 'Chore', color: 'teal' }),
);
labelCase(
  'renaming a built-in label',
  () => app.BLUR.labelName({ value: 'Defect', dataset: { id: 'bug', orig: 'Bug' } }),
  d => changeLabel(d, 'bug', { name: 'Defect' }),
);
labelCase(
  'recolouring a label typed onto a task',
  () => app.IN.labelColor({ value: 'green', dataset: { id: 'ops' } }),
  d => changeLabel(d, 'ops', { color: 'green' }),
);
labelCase(
  'deleting a label in use',
  () => {
    app.A.delLabel({ dataset: { id: 'ops' } });
    confirm();
  },
  d => deleteLabel(d, 'ops', NOW),
);
