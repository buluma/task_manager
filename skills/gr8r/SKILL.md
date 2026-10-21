---
name: gr8r
description: Work ShadowWalker's personal task server (Gr8r Studio) through its `gr8r` CLI and HTTP API. Use when asked to add, list, update, complete, cancel, move, archive, restore, comment on, label, plan or clean up tasks, projects, priorities, labels, subtasks or dependencies on that server; to manage members, teams or project milestones; to link GitHub PRs to tasks, register agents, raise or read Inbox items; to bulk import or fix task data; or to check, restart or troubleshoot the gr8r server. Triggers on "gr8r", "my tasks", "task server", "add a task", "task manager API/CLI".
---

# gr8r: tasks, projects, people and the Inbox from the shell

Gr8r Studio is a personal task manager. One server holds the whole workspace; the browser app, the `gr8r` CLI and the HTTP API all read and write the same state. The data is real and in daily use: treat every write as production.

## Where things are

- Repo: `/Users/shadowwalker/Documents/GitHub/task_manager` (Node, no runtime dependencies). `docs/api.md` there lists every route and `docs/cli.md` every command. This skill lives in that repo as `skills/gr8r/SKILL.md`; the copies under `~/.claude`, `~/.agents` and `~/.codex` are symlinks to it, so edit it there, through a PR.
- Server: `http://100.100.245.3:8787` (what the CLI uses), and `https://shadownet-m1.tailb95e.ts.net:8443` for browsers (`tailscale serve` in front of 127.0.0.1:8787; HTTPS is what makes Copy link and other secure-page features work). Tailnet only. Tailscale must be up. It runs under launchd as `com.buluma.gr8r-server`, from that repo checkout.
- Data: `~/.gr8r/state.json` (one JSON file, revision-numbered). Never edit it by hand while the server runs; go through the API or CLI.
- Config: the repo's gitignored `.env` holds `GR8R_TOKEN` and `GR8R_URL`. The CLI and server load it themselves, so `gr8r ...` works from any directory with nothing exported. **Never print, log, paste or commit the token.** Use `grep '^GR8R_TOKEN=' .env | cut -d= -f2-` into a variable if you need it for curl, and never echo it.
- CLI: `gr8r` (npm-linked from the repo's `bin/gr8r.js`). `gr8r help` prints the full usage.
- Backups: a launchd job (`com.buluma.gr8r-backup`) snapshots daily at 03:30 into `~/.gr8r/backups/` (keeps 14).

## Ground rules

1. **Look before you write.** `gr8r list`, `gr8r show KEY`, `gr8r projects`, `gr8r priorities` first. Keys are `PROJECT-N` (`GR-12`, `PP-3`); lookups are case-insensitive.
2. **Back up before bulk or destructive work.** `launchctl kickstart gui/$(id -u)/com.buluma.gr8r-backup`, then check that `tail -2 ~/.gr8r/backup.log` shows a `backed up to` line from just now (the last line is usually `pushed off-site`; failures go to `~/.gr8r/backup.err.log`). For one-off bulk jobs write a script with a dry run by default and `--apply` to write, test it against a throwaway server on a copy of `~/.gr8r/state.json` (`GR8R_PORT=8799 GR8R_DATA=<copy> GR8R_TOKEN=<test> GR8R_ENV_FILE= node server/index.js`), then run it live.
3. **Archive is the default delete.** `gr8r rm KEY` archives and `gr8r restore KEY` brings it back. `--purge` is permanent and only works on something already archived. Ask the user before any purge.
4. **Moving a task to another project changes its key** (`GR-6` becomes `PP-1`); the old key stops working. Tell the user.
5. **Verify after every write** with `gr8r show KEY` or `gr8r list`, and report what actually changed, not what you intended.
6. **Do not commit, push or open PRs unless asked.** Never use `--no-verify`, amend or force-push.
7. **Write as the agent.** Register yourself once (`gr8r agent add Claude`), then put `--as Claude` on every write (or export `GR8R_AGENT=Claude`), so comments and activity are logged to you and not to the owner. Without it your writes look like ShadowWalker's.

## Commands

```
gr8r list [--status S] [--priority P] [--project KEY] [--cycle current|none|DATE] [--query TEXT] [--pr yes|no] [--archived]
gr8r show KEY
gr8r add TITLE [--project KEY] [--status S] [--priority P] [--due DATE] [--start DATE] [--cycle current|DATE]
         [--label L ...] [--desc TEXT [--markdown]] [--estimate E] [--completed DATE] [--recur Daily|Weekly|"Every 2 weeks"|Monthly]
gr8r set KEY  [--title T] [--project KEY] [--status S] [--priority P] [--due DATE|none] [--start DATE|none]
         [--cycle current|DATE|none] [--label L ... | --label none] [--desc TEXT [--markdown]] [--estimate E|none]
         [--completed DATE|none] [--recur ...|none]
gr8r done KEY                 # prints the next occurrence if the task repeats
gr8r rm KEY [--purge]        gr8r restore KEY
gr8r subtask add KEY TITLE    gr8r subtask done|reopen|rm KEY SUBTASK_ID
gr8r deps KEY                 gr8r dep add|rm KEY OTHER_KEY      # KEY waits for OTHER_KEY
gr8r comments KEY             gr8r comment KEY TEXT [--at DATE]  gr8r comment rm KEY COMMENT_ID
gr8r pr link KEY URL          # records a github.com/OWNER/REPO/pull/N link as a "PR: URL" comment; repeating it is a no-op
gr8r agent add NAME           gr8r agent list                    # agents are members with agent: true
gr8r notify TEXT [--task KEY] [--snippet TEXT] [--type needs|comment|update|mention|assign] --as NAME
gr8r inbox [--unread]         gr8r inbox read|unread ID
gr8r projects [--archived]    gr8r project show|add|set|rm|restore ...   (rm --purge deletes for good)
gr8r priorities               gr8r priority add NAME --weight 1-99 [--id ID] | set ID | rm ID [--replace ID]
gr8r labels                   gr8r label add NAME [--color C] | set ID [--name N] [--color C] | rm ID
gr8r members                  gr8r member add EMAIL... [--role Admin|Member|Guest] [--team T]
gr8r member set ID|EMAIL [--name N] [--title T] [--role R] [--team T|none]      gr8r member rm ID|EMAIL
gr8r teams                    gr8r team add NAME [--desc TEXT] [--icon I] [--color C] [--member ID ...]
gr8r team set ID|NAME [... --member ID ... | --member none]                     gr8r team rm ID|NAME
gr8r milestones KEY           gr8r milestone add KEY NAME --date DATE   milestone set KEY NAME [--name N] [--date DATE]   milestone rm KEY NAME
```

Any command also takes `--as NAME` (an agent registered with `gr8r agent add`).

Add `--json` to any command for machine-readable output. Values:

- status: `backlog todo progress review done cancelled` (done and cancelled are the two closed states: neither is overdue, open or carried to the next cycle, and cancelled tasks are left out of project progress)
- priority: ids from `gr8r priorities` (default `urgent high medium low none`; the scale is editable, so check)
- project status: `planning active risk hold complete`; project colors: indigo blue violet teal rose amber green slate
- dates: `YYYY-MM-DD`; `none` clears due, start, cycle, estimate, completed, recur
- `--cycle current` means this week's cycle (weeks start on the day set in the app's prefs)

## Behaviours worth knowing

- `--desc` is plain text by default (HTML-escaped; blank lines make paragraphs). Add `--markdown` to render headings, lists, bold/italic, code, quotes and links; raw HTML is always escaped. For multi-line text in zsh use `$'line one\n\nline two'`.
- Completing a repeating task that has a due date creates the next occurrence (due and start move forward by the repeat length).
- `--completed` only applies to done tasks. A task completed through `gr8r done` is stamped now.
- Deleting a priority level moves its tasks to `none` unless you pass `--replace ID`. `none` cannot be deleted or reweighted.
- A project's key cannot be changed once created.
- Comments are stored as written and the app renders them as markdown (bold, lists, code, links; raw HTML stays escaped), with `@Name` mentions highlighted. `--at` backdates one and keeps it out of the activity feed.
- Archived tasks and projects are hidden from `list` and `projects` unless you pass `--archived`.
- **Agents and attribution.** `--as NAME` sends `X-Gr8r-Agent`; the server logs the write to that agent. An unknown name, or a human member, is refused with a 400 and nothing is written. It is attribution, not authentication: the one shared token still applies. Tasks an agent creates stay assigned to the owner.
- **Inbox.** When an agent comments on or moves a task, the owner gets an Inbox item automatically (comments as `comment`, moves and completions as `update`). The owner's own writes and backdated (`--at`) comments raise nothing. Raise one by hand with `gr8r notify`. Use `--type needs` when you are blocked on ShadowWalker (a question, approval or review): it shows on the Inbox "Needs you" tab and lights the sidebar badge. `update` items do not light the badge.
- **PR links** live only as `PR: URL` comments (there is no links field). Only a comment that starts with `PR: ` and the URL counts, so a PR mentioned anywhere else in a comment is not the task's PR; use `gr8r pr link` to link one. The app's task drawer shows a PR icon for the newest one, and board cards, list rows and table rows show one coloured by its state (open, draft, merged, closed), which the server looks up on GitHub through the open `GET /api/prs` route (needs `GR8R_GITHUB_TOKEN` in `.env` for private repos). Every 10 minutes the server moves tasks in Review whose linked PR has merged to Done and raises an Inbox item; nothing else changes status on its own, so move a task to Review once its PR is up.
- **Members and teams.** Roles you can give are `Admin`, `Member` and `Guest`; the owner keeps `Owner` and cannot be removed (409). Removing a member unassigns all their tasks and takes them off every project; ask the user first. A member is in at most one team: joining one leaves the old, and `team set --member ...` sets exactly who is in it. Deleting a team keeps its people and projects, teamless. None of this is logged in the activity feed (the app doesn't log it either).
- **Labels.** Check `gr8r labels` before labelling, and reuse a label that fits (case doesn't matter: `bug` is `Bug`). You may create a label when none fits and the same kind of task will keep coming up: `gr8r label add NAME --color C --as Claude`, a short Title Case noun (`Chore`, `Tech debt`), not a one-off or a project name. Mention new labels in your report. Renaming or deleting a label the user already has changes their workspace: ask first. `--label X` on `add`/`set` takes a label id; one that doesn't exist yet becomes a gray label, so create it first if it should have a colour. Colours: violet blue teal amber rose red green orange gray.
- **Estimates.** Give every task you create an estimate of the effort left, using only the app's picker values: `30m 1h 2h 4h 1d 2d 3d 5d 8d` (a day is a focused working day). Round up, and split anything bigger than `8d` into smaller tasks or subtasks. Re-estimate with `gr8r set KEY --estimate X --as Claude` when you learn the scope changed, and say so in your report. Leave estimates the user set alone unless asked. On a task you log after the fact (Done when created), record the effort it actually took. Estimates are a free-text field: the app shows and sorts them but does not total them yet.
- **Milestones** are `{ name, date }` on a project, named uniquely within it. The app only shows them (overview, timeline); the CLI and API are the only way to change them.
- **Links.** The app's Copy link gives `<the address you opened the app on>/#task/KEY` or `#project/key`, which open that task or project.
- The `gr8r` project is planned to be renamed Cairn (tasks in project `CRN`), not done yet. Check `gr8r help` if a command or path has moved.

## HTTP API, when the CLI is not enough

Base `http://100.100.245.3:8787`, header `Authorization: Bearer <token>` on every `/api/` route except `/api/rev` and `/api/state`. Add `X-Gr8r-Agent: <name or id>` to a write to attribute it to a registered agent. `/api/rev` and `/api/state` are open to the tailnet. Writes need `content-type: application/json`. The repo's `docs/api.md` lists every route; the main ones:

```
GET/POST   /api/tasks            GET/PATCH/DELETE /api/tasks/KEY   (DELETE ?purge=1; PATCH archived: false restores)
GET/POST   /api/tasks/KEY/comments   DELETE /api/tasks/KEY/comments/ID
POST       /api/tasks/KEY/subtasks   PATCH/DELETE /api/tasks/KEY/subtasks/ID
GET/POST   /api/tasks/KEY/deps       DELETE /api/tasks/KEY/deps/OTHER_KEY
GET/POST   /api/projects         GET/PATCH/DELETE /api/projects/KEY
GET/POST   /api/priorities       PATCH/DELETE /api/priorities/ID   (DELETE ?replace=ID)
GET/POST   /api/agents           (POST: name)
GET/POST   /api/notifications    (GET ?unread=1; POST: text, optional task key, snippet, type)
PATCH      /api/notifications/ID (read: true|false)
GET/POST   /api/labels           PATCH/DELETE /api/labels/ID
GET/POST   /api/members          PATCH/DELETE /api/members/ID_OR_EMAIL
GET/POST   /api/teams            PATCH/DELETE /api/teams/ID_OR_NAME
GET/POST   /api/projects/KEY/milestones   PATCH/DELETE /api/projects/KEY/milestones/NAME
```

Errors come back as `{ "error": "..." }` with a 400, 404, 409 or 401 status. A 409 on `/api/state` means a stale revision: another writer got there first.

## Troubleshooting

- `cannot reach http://...` : Tailscale is off, or the server is down. `tailscale status`, then `launchctl print gui/$(id -u)/com.buluma.gr8r-server | head`.
- `unauthorized` / 401: the token is missing or wrong. The CLI reads the repo `.env`; check `GR8R_TOKEN` is set there and that no stale `GR8R_TOKEN` is exported in the shell (a shell value wins over the file).
- Restart: `launchctl kickstart -k gui/$(id -u)/com.buluma.gr8r-server`. After changing app code run `npm run build` in the repo first. Logs: `~/.gr8r/server.log` and `server.err.log`.
- The browser app merges CLI and API writes into an open tab on its next save; it only asks to reload ("changed on another device") when the server keeps changing under it. A reload fixes it.
- A request that hangs is cut off by the CLI after 10 s (`GR8R_TIMEOUT_MS` to change).

## Working on the project itself

`cd /Users/shadowwalker/Documents/GitHub/task_manager`; `npm test` (built-in `node --test`), `npm run lint`, `npm run format:check`, `npm run build`. CI runs the same on every PR. Tests come first for behaviour changes. The live server runs from this checkout and serves `dist/` straight from disk, so `npm run build` on a feature branch changes the live app immediately, before any merge or restart; the server's own code only changes on restart. Check which branch is checked out before building or restarting. Flow used so far: branch, PR to `buluma/task_manager`, wait for CI, merge only when asked, `git pull` on `main`, `npm run build`, restart, then delete the branch.
