# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Gr8r Studio: a plain-JavaScript (ES modules, no framework) project manager bundled by Vite, plus a dependency-free Node server and a `gr8r` CLI. The README and `docs/` cover usage, the source layout and every route; this file covers what takes several files to see.

## Commands

```bash
npm run dev                          # Vite on :5173 (proxies /api to 127.0.0.1:8787)
npm run build                        # production build into dist/
npm test                             # node --test: server, CLI and src/core unit tests
node --test server/tasks.test.js     # one file
node --test --test-name-pattern="cancelled" server/tasks.test.js   # one test by name
npm run lint && npm run format:check # both run in CI, along with test and build
npx prettier --write <files>         # printWidth 160; run it on what you touched
```

CI (`.github/workflows/ci.yml`) runs lint, `format:check`, test and build. Node 18 is the floor for the app, server and CLI (`.nvmrc` pins 22), so avoid newer APIs such as `process.loadEnvFile` there. The tests need Node 22.15+: `server/app-harness.js` loads the app's code under Node with `module.registerHooks`. Check `npm run lint` by its exit code, not by the last line of output.

## Architecture

**One state object, two writers.** The workspace is a single JSON object (`data`, `prefs`, `views`). The browser app owns it in `src/core/store.js` (`S`), caches it in localStorage and syncs the whole thing through `GET/PUT /api/state` with a revision number (`src/core/sync.js`); a 409 means someone else saved first: the tab merges its save with theirs record by record (`src/core/merge.js`; theirs wins a same-field clash), adopts the result through `gr8r:merged` in `src/main.js` and saves again, and only stops writing until reload if the server keeps moving. The server (`server/app.js`) stores it as one file, `~/.gr8r/state.json`, and the task, project, priority, agent and notification APIs mutate it too.

**The app and the server share their writes.** Every change the API makes to tasks, projects, subtasks, comments, archives, members and teams runs the same code the app runs, in `src/core/` (`tasks.js` and `projects.js` for creating and changing tasks and projects, `subtasks.js`, `comments.js`, `archive.js`, `members.js`, `teams.js`, all logging through `activity.js`; also `constants.js`, `priorities.js` and `labels.js` (the workspace's priority scale and labels, with the live `PR` and `LB` the app draws from), `cycles.js`, `recur.js`, `markdown.js`). Each side keeps only its own part around those calls: the app its highlight effects, toasts and form handling; the server validation, its create defaults (a task in the backlog assigned to `data.me`, a project with no due date in its lead's team), description rendering and agent notifications. Nothing the API writes is mirrored any more; keep it that way by putting any new shared change in `src/core/`. `server/parity.test.js` drives the app's real handlers and the matching API routes on the same state and compares the results; add a case when you add a field or an action. Each server write runs on a `structuredClone` of the state inside `mutate` in `app.js`, validates before it mutates, and is persisted before it becomes current.

**Attribution.** `X-Gr8r-Agent` (`gr8r --as NAME`) sets a transient `data.actor` on the cloned state for the length of one request; `actorOf(data)` in `server/tasks.js` is what logs and comments use for `by`. It is deleted before saving, so never persist it. Defaults like a new task's assignee deliberately keep using `data.me`.

**Rendering.** Pages and views are functions returning HTML strings from the store; interactions use `data-a="name"` and are delegated to the action table `A` (details in `docs/architecture.md`). New pure logic goes in `src/core/` with a test next to it (see `inbox.js`, `pr-links.js`, `cycles.js`), because UI modules have no tests.

**Icons** come from a Vite plugin (`vite.config.js`) that bundles every Lucide icon whose name appears as a quoted kebab-case string anywhere in `src/`. Naming an icon in a string is enough; there is no import.

## Adding or changing a task status

A status is spread over several places, and missing one fails quietly: `STATUSES` in `src/core/constants.js` (the popovers, board, filters and counts all derive from it), `--st-<id>` in all three blocks of `src/styles/tokens.css`, the icon branch in `stIcon` (`src/ui/helpers.js`), and the CLI help in `bin/gr8r.js`. Use `isOpen(t)` from `src/core/store.js` instead of comparing to `'done'`, so done and cancelled both count as closed. The status popover's number hotkeys are a regex in `src/actions/keyboard.js`.

## The live server

This checkout is also the running production server (launchd job `com.buluma.gr8r-server`, started by `~/.gr8r/run-server.sh`, listening on the Tailscale address and 127.0.0.1, data in `~/.gr8r/state.json`). Browsers use `https://shadownet-m1.tailb95e.ts.net:8443`, which `tailscale serve` proxies to 127.0.0.1:8787 (`tailscale serve status`); `http://100.100.245.3:8787` still works for the CLI.

- The server serves `dist/` from disk, so `npm run build` on any branch changes the live app immediately. To look at a branch without that, build elsewhere: `npx vite build --outDir <dir>` and `npx vite preview --outDir <dir>`.
- Server code only changes on restart: `launchctl kickstart -k gui/$(id -u)/com.buluma.gr8r-server`. Build first, then restart, from `main`.
- Never edit `state.json` by hand. Use the API or CLI (tasks, projects, priorities, members, teams, milestones); for anything they don't cover, the app's own `PUT /api/state` (read the state, change it, send it back with `baseRev`) is the supported route.
- Before a live write: `launchctl kickstart gui/$(id -u)/com.buluma.gr8r-backup` and check that `tail -2 ~/.gr8r/backup.log` shows a `backed up to` line from just now (the last line is usually `pushed off-site`; failures go to `~/.gr8r/backup.err.log`), then rehearse on a copy with `GR8R_PORT=8799 GR8R_DATA=<copy> GR8R_TOKEN=<test> GR8R_ENV_FILE= node server/index.js`.
- `.env` (gitignored) holds `GR8R_TOKEN` and `GR8R_URL`; never print the token.
- `skills/gr8r/SKILL.md` is the agent skill for working the live server. `~/.claude/skills/gr8r/SKILL.md`, `~/.agents/skills/gr8r/SKILL.md` and `~/.codex/skills/gr8r/SKILL.md` are symlinks to it, so they follow `main`; update it in the same PR as a CLI or API change.
