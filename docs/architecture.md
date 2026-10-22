# Architecture

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
    views/              list, board, table, calendar, timeline, projects
    pages/              home, inbox, projects, settings and the other pages
  core/                 utilities, constants, icons, store (state + lookups), theme
  data/seed.js          demo workspace data
  ui/                   shared render helpers, toasts, the select dropdown
  shell/                render loop and router, sidebar/topbar layout, view engine
  components/           task list renderer
  pages/                one module per route
  views/                project views: board, table, calendar, timeline, overview
  overlays/             task drawer, modals, popovers, context menu, command palette
  features/             teams, subtasks, archive (rendering)
  actions/              user actions, event wiring, keyboard shortcuts, drag and drop
```

## Layers

Dependencies point downward:

1. `core/` and `data/` depend on nothing else in the app.
2. `ui/`, `shell/`, `components/`, `pages/`, `views/`, `overlays/` and `features/` render HTML from state.
3. `actions/` change state and re-render. Each action module registers its handlers on the shared action table (`A`) when it loads, so `main.js` imports them after `actions/actions.js`.

## Conventions

- **Rendering:** each page or view is a function that returns an HTML string from the store (`S`). `render()` rebuilds the shell and keeps focus and scroll positions.
- **Interactions:** elements declare `data-a="actionName"`. `actions/events.js` delegates the click to `A.actionName`. Inputs use `data-in`, blur handlers use `data-blur`.
- **Layout:** every page edge uses `var(--gutter)`, so the breadcrumb, page header, toolbar, list, table and board start on the same line.
- **Dropdowns:** write a normal `<select class="select">`. `ui/select.js` renders it as the design-system menu and keeps the native element as the source of truth.
- **Icons:** call `ic('name')` with any [Lucide](https://lucide.dev) icon name. The `virtual:icons` plugin bundles only the icons the source uses.

## Offline saves

The workspace cache is written synchronously on each save. `gr8r.sync.v1` keeps the last synced revision and baseline plus a pending snapshot. A reload restores pending work before reading remote state; reconnecting sends it with its original revision, using the same three-way merge as concurrent online edits. Successful writes clear the pending snapshot. Network requests have timeouts and retry while the tab stays open. Browser storage must be available to preserve offline work across browser restarts.

## Shared and device settings

Profile and calendar preferences (including `name`, `title` and `weekStart`) and `views` configurations sync with workspace `data`. Idle polling and conflict merges use the same adoption function before another edit can save. Missing shared preferences receive application defaults.

Appearance (`theme`, `accent`, `side`, `density`, `motion`), date formatting (`dateFmt`), navigation defaults (`home`, `openTasks`), sidebar collapse and the selected Personal/Work/All workspace remain local to each device. They stay in the browser cache and are omitted from new server snapshots. Existing server snapshots remain readable: legacy device preferences initialize a new device, but later remote adoption cannot change its local choices.
