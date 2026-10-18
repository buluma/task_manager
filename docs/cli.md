# CLI

`gr8r` is a command-line client for the task API. It talks to the server described in [server.md](server.md); the routes it wraps are in [api.md](api.md).

## Setup

Run `npm link` in the repo to get a `gr8r` command. Point it at the server with `GR8R_URL` (default `http://127.0.0.1:8787`) and give it the token in `GR8R_TOKEN`. Instead of exporting them you can put both in the repo's `.env`, which the CLI and the server read; a variable already set in the shell wins. Requests give up after 10 seconds, and `GR8R_TIMEOUT_MS` changes that.

Every command exits non-zero with a message on stderr when it fails. Add `--json` to any command for machine-readable output. `gr8r help` prints the full usage.

```bash
export GR8R_URL=http://100.x.y.z:8787
gr8r add "write report" --priority high --cycle current
gr8r list --cycle current
gr8r set GR-3 --status progress
gr8r done GR-3
```

## Tasks

Tasks are addressed by key, `PROJECT-N` (`GR-12`), and keys are case-insensitive.

| Command                           | Does                                                                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list [filters]`                  | list tasks; filters are `--status`, `--priority`, `--project KEY`, `--cycle current\|none\|DATE`, `--query TEXT` and `--archived`                              |
| `show KEY`                        | one task with its description and subtasks                                                                                                                     |
| `add TITLE [options]`             | create a task (`--project`, `--status`, `--priority`, `--due`, `--start`, `--cycle`, `--label` (repeatable), `--desc`, `--estimate`, `--completed`, `--recur`) |
| `set KEY [options]`               | change a task; the same options plus `--title` and `--project` (moving re-keys the task, so `GR-6` can become `PP-1` and the old key stops working)            |
| `done KEY`                        | mark complete; a repeating task with a due date prints its next occurrence                                                                                     |
| `rm KEY`                          | archive the task (`restore KEY` or the app's Archive page brings it back)                                                                                      |
| `restore KEY`                     | bring an archived task back                                                                                                                                    |
| `rm KEY --purge`                  | delete an already archived task for good                                                                                                                       |
| `subtask add KEY TITLE`           | add a subtask                                                                                                                                                  |
| `subtask done\|reopen\|rm KEY ID` | complete, reopen or remove a subtask                                                                                                                           |
| `deps KEY`                        | list what the task waits for                                                                                                                                   |
| `dep add\|rm KEY OTHER_KEY`       | make `KEY` wait for `OTHER_KEY`, or stop waiting                                                                                                               |
| `comments KEY`                    | list a task's comments                                                                                                                                         |
| `comment KEY TEXT [--at DATE]`    | add a comment; `--at` backdates it and keeps it out of the activity feed                                                                                       |
| `comment rm KEY ID`               | delete a comment                                                                                                                                               |
| `pr link KEY URL`                 | record a `https://github.com/OWNER/REPO/pull/N` link as a `PR: URL` comment; linking the same PR twice does nothing                                            |

Accepted values:

- **Status:** `backlog`, `todo`, `progress`, `review`, `done`, `cancelled`. Done and cancelled are the two closed states: neither counts as open or overdue, and cancelled tasks are left out of project progress.
- **Priority:** the ids from `gr8r priorities` (by default `urgent`, `high`, `medium`, `low`, `none`; the scale is editable).
- **Dates:** `YYYY-MM-DD`. `none` clears `--due`, `--start`, `--cycle`, `--estimate`, `--completed` and `--recur`, and `--label none` clears the labels.
- **Cycle:** `current` is this week's cycle (the week starts on the day set in the app's preferences).
- **Recur:** `Daily`, `Weekly`, `"Every 2 weeks"` or `Monthly`.
- **Completed:** `--completed DATE` sets a completion date and only works on done tasks. `gr8r done` stamps now.

`--desc` is plain text by default (HTML-escaped; blank lines start paragraphs). Add `--markdown` to render headings, lists, bold, italic, code, quotes and links; raw HTML is always escaped. In zsh, write multi-line text as `$'line one\n\nline two'`.

## Projects

| Command                      | Does                                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ |
| `projects [--archived]`      | list projects                                                                                          |
| `project show KEY`           | one project                                                                                            |
| `project add NAME [options]` | create a project: `--key`, `--desc`, `--color`, `--icon`, `--status`, `--due`, `--lead`                |
| `project set KEY [options]`  | change `--name`, `--desc`, `--color`, `--icon`, `--status`, `--due` or `--lead`; the key never changes |
| `project rm KEY`             | archive the project, keeping its tasks                                                                 |
| `project restore KEY`        | bring an archived project back                                                                         |
| `project rm KEY --purge`     | delete an archived project with its tasks, comments and activity for good                              |

Project status is `planning`, `active`, `risk`, `hold` or `complete`. Colours are `indigo`, `blue`, `violet`, `teal`, `rose`, `amber`, `green` and `slate`.

## Members, teams and milestones

| Command                                           | Does                                                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `members`                                         | list everyone in the workspace, agents included                                                                    |
| `member add EMAIL... [--role R] [--team T]`       | add people by email (`--role` `Admin`, `Member` or `Guest`, default `Member`); known addresses are skipped         |
| `member set ID\|EMAIL [options]`                  | change `--name`, `--title`, `--role` or `--team` (`none` for no team); the owner keeps the Owner role              |
| `member rm ID\|EMAIL`                             | remove someone: their tasks are unassigned and they leave every project; the owner can't be removed                |
| `teams`                                           | list teams                                                                                                         |
| `team add NAME [options]`                         | create a team: `--desc`, `--icon`, `--color` (as for projects), `--member ID` (repeatable)                         |
| `team set ID\|NAME [options]`                     | change `--name`, `--desc`, `--icon` or `--color`; `--member ID ...` sets who is in it (`--member none` empties it) |
| `team rm ID\|NAME`                                | delete a team; its members and projects are kept, with no team                                                     |
| `milestones KEY`                                  | a project's milestones                                                                                             |
| `milestone add KEY NAME --date DATE`              | add a milestone (names are unique within a project)                                                                |
| `milestone set KEY NAME [--name N] [--date DATE]` | rename or move a milestone                                                                                         |
| `milestone rm KEY NAME`                           | remove a milestone                                                                                                 |

## Priorities

| Command                                      | Does                                                                |
| -------------------------------------------- | ------------------------------------------------------------------- |
| `priorities`                                 | the scale, highest weight first, with how many tasks use each level |
| `priority add NAME --weight 1-99 [--id ID]`  | add a level                                                         |
| `priority set ID [--name N] [--weight 1-99]` | rename or reweight a level; `none` always weighs 0                  |
| `priority rm ID [--replace ID]`              | remove a level; its tasks move to the replacement (default `none`)  |

## Agents and the Inbox

Register an agent once with `gr8r agent add NAME`, then put `--as NAME` on any command (or export `GR8R_AGENT=NAME`) to log that write to the agent in comments and activity instead of you. This is attribution, not authentication: the one shared token still applies, and an unknown name is refused. Tasks an agent creates stay assigned to you.

| Command                                                   | Does                                                                                                                  |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `agent add NAME`                                          | register an agent                                                                                                     |
| `agent list`                                              | list agents                                                                                                           |
| `notify TEXT [--task KEY] [--snippet TEXT] [--type TYPE]` | raise an Inbox item (use it with `--as`); `TYPE` is `needs`, `comment` (the default), `update`, `mention` or `assign` |
| `inbox [--unread]`                                        | list Inbox items, newest first                                                                                        |
| `inbox read\|unread ID`                                   | mark one item                                                                                                         |

When an agent comments on or moves a task, you get an Inbox item without it doing anything extra. Your own writes, and backdated comments, raise nothing. Use `--type needs` when an agent is blocked on you: it shows on the Inbox "Needs you" tab and lights the sidebar badge, which `update` items do not.

```bash
gr8r agent add Claude
gr8r comment GR-3 "tests pass" --as Claude
gr8r notify "needs your call" --task GR-3 --type needs --as Claude
gr8r inbox --unread
gr8r pr link GR-3 https://github.com/OWNER/REPO/pull/7
```
