# Gr8r Studio

A calm, structured project management workspace: home dashboard, inbox, my tasks, projects with
board / list / table / calendar / timeline / files views, members, teams, activity and settings.

Built with plain JavaScript ES modules and CSS, bundled by [Vite](https://vite.dev). There is no
UI framework and no runtime dependency.

![Gr8r Studio home dashboard](docs/preview.png)

## Getting started

Requires Node.js 18 or newer (`.nvmrc` pins 22).

```bash
npm install
npm run dev       # http://localhost:5173 with hot reload
npm run build     # production build in dist/
npm run preview   # serve the production build locally
npm run lint      # ESLint
npm run format    # Prettier
```

## Project structure

```
index.html              HTML entry; loads src/main.js
public/favicon.svg      brand mark
vite.config.js          Vite config, including the Lucide icon-subset plugin
eslint.config.js        lint rules (ESLint flat config); formatting by Prettier (.prettierrc.json)
.github/workflows/      CI: lint, format check, build
docs/preview.png        README screenshot
server/                 personal sync server and task API (no dependencies), with tests
bin/gr8r.js             command-line client for the task API
src/
  main.js               entry: imports styles and modules, then boots the app
  styles/
    index.css           imports every stylesheet in cascade order
    tokens.css          colours, spacing, type, radius, the shared --gutter
    base.css  components.css  shell.css  panels.css  overlays.css  states.css  motion.css  responsive.css
    views/              list, board, table, calendar, timeline, projects & files
    pages/              settings, auth & onboarding
  core/                 utilities, constants, icons, store (state + lookups), theme
  data/seed.js          demo workspace data
  ui/                   shared render helpers, toasts, the select dropdown
  shell/                render loop and router, sidebar/topbar layout, skeletons, view engine
  components/           task list renderer
  pages/                one module per route
  views/                project views: board, table, calendar, timeline, files, overview
  overlays/             task drawer, modals, popovers, context menu, command palette
  features/             teams, subtasks, archive (rendering)
  actions/              user actions, event wiring, keyboard shortcuts, drag and drop
```

### Layers

Dependencies point downward:

1. `core/` and `data/` depend on nothing else in the app.
2. `ui/`, `shell/`, `components/`, `pages/`, `views/`, `overlays/` and `features/` render HTML from state.
3. `actions/` change state and re-render. Each action module registers its handlers on the
   shared action table (`A`) when it loads, so `main.js` imports them after `actions/actions.js`.

## Conventions

- **Rendering:** each page or view is a function that returns an HTML string from the store
  (`S`). `render()` rebuilds the shell and keeps focus and scroll positions.
- **Interactions:** elements declare `data-a="actionName"`. `actions/events.js` delegates the
  click to `A.actionName`. Inputs use `data-in`, blur handlers use `data-blur`.
- **Layout:** every page edge uses `var(--gutter)`, so the breadcrumb, page header, toolbar,
  list, table and board start on the same line.
- **Dropdowns:** write a normal `<select class="select">`. `ui/select.js` renders it as the
  design-system menu and keeps the native element as the source of truth.
- **Icons:** call `ic('name')` with any [Lucide](https://lucide.dev) icon name. The
  `virtual:icons` plugin bundles only the icons the source uses.

## Personal server and CLI

The app works on its own from browser storage. To keep one copy of your data across browsers and devices, run the sync server, which also serves the built app and a small task API. It has no authentication, so bind it to a private interface such as your Tailscale address and never to 0.0.0.0.

```bash
npm run build
GR8R_HOST=$(tailscale ip -4) npm start     # http://<tailnet-ip>:8787, data in ~/.gr8r/state.json
```

`GR8R_HOST` (default 127.0.0.1), `GR8R_PORT` (default 8787) and `GR8R_DATA` (state file) configure it, and `GR8R_TOKEN` makes the task, project and priority APIs require `Authorization: Bearer <token>` (the CLI sends `GR8R_TOKEN` from its own environment). Instead of exporting variables you can put them in a `.env` file at the repo root, which is gitignored and read by both the server and the CLI; variables already set in the shell win, and `GR8R_ENV_FILE` points to a different file. The token does not cover `/api/rev` and `/api/state`, which the browser app uses without credentials, so it stops casual API use but not a deliberate write of the whole state; keep the server on a private interface. Open the app once so it saves its starting state, then the API accepts writes. Open tabs pick up changes made through the API within a few seconds.

| Request                                                          | Does                                                                                                                                                                                                                                   |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/tasks?status=&priority=&project=&cycle=&q=&archived=1` | list tasks (`cycle` is `current`, `none` or a date)                                                                                                                                                                                    |
| `POST /api/tasks`                                                | create a task: `title` plus optional `project`, `status`, `priority`, `due`, `start`, `cycle`, `labels`, `desc`, `estimate`, `assignee`, `completed`                                                                                   |
| `GET /api/tasks/GR-1`                                            | one task by key                                                                                                                                                                                                                        |
| `PATCH /api/tasks/GR-1`                                          | change `title`, `desc`, `status`, `priority`, `due`, `start`, `labels`, `assignee`, `cycle`, `estimate`, `completed` (a completion date, for done tasks only) or `project` (moving re-keys the task from the target project's counter) |
| `DELETE /api/tasks/GR-1`                                         | archive the task (restore it from the Archive page); with `?purge=1`, delete an already archived task for good                                                                                                                         |
| `GET/POST /api/tasks/GR-1/comments`                              | list a task's comments, or add one: `text` and an optional `at` (ISO date) to backdate it                                                                                                                                              |
| `DELETE /api/tasks/GR-1/comments/ID`                             | delete one comment                                                                                                                                                                                                                     |
| `GET /api/projects?archived=1`                                   | list projects (archived ones only with the flag)                                                                                                                                                                                       |
| `POST /api/projects`                                             | create a project: `name` plus optional `key`, `desc`, `color`, `icon`, `status`, `due`, `lead`                                                                                                                                         |
| `GET/PATCH /api/projects/GR`                                     | one project; change `name`, `desc`, `color`, `icon`, `status`, `due`, `lead`, `archived` (the key never changes)                                                                                                                       |
| `DELETE /api/projects/GR`                                        | archive the project, keeping its tasks (`PATCH` `archived: false` restores it); with `?purge=1`, delete an already archived project and all its tasks for good                                                                         |
| `GET /api/priorities`                                            | the priority scale, highest weight first, with how many tasks use each level                                                                                                                                                           |
| `POST /api/priorities`                                           | add a level: `name`, `w` (1-99) and optionally `id`                                                                                                                                                                                    |
| `PATCH /api/priorities/high`                                     | rename or reweight a level (`none` always weighs 0)                                                                                                                                                                                    |
| `DELETE /api/priorities/high?replace=medium`                     | remove a level; its tasks move to `replace` (default `none`)                                                                                                                                                                           |
| `GET/PUT /api/state`                                             | the whole workspace, guarded by a revision number (`baseRev`)                                                                                                                                                                          |

The priority scale lives in the workspace state, so levels added through the API show up in the app's pickers, filters and grouping within a few seconds. Edit the scale in the app under Settings → Priorities, or through the API. The `urgent` level keeps its special icon and the other levels spread over one to three bars by rank.

Completing a repeating task (`recur`: Daily, Weekly, Every 2 weeks or Monthly) that has a due date schedules the next occurrence, as in the app; the response carries it as `next`.

The CLI wraps the same API. Point it at the server with `GR8R_URL`, and use `npm link` to get a `gr8r` command. Requests give up after 10 seconds; set `GR8R_TIMEOUT_MS` to change that.

```bash
export GR8R_URL=http://100.x.y.z:8787
gr8r add "write report" --priority high --cycle current
gr8r list --cycle current
gr8r set GR-3 --status progress
gr8r done GR-3
gr8r project add "Website" --key WEB --color teal
gr8r priority add Blocker --weight 5
gr8r priority rm low --replace medium
gr8r help
```

## Continuous integration

Every push and pull request runs lint, the format check and a production build
(`.github/workflows/ci.yml`).

## Deploy

`vercel.json` builds with Vite and serves `dist/`.
