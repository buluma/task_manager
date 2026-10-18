# Personal server and CLI

The app works on its own from browser storage. To keep one copy of your data across browsers and devices, run the sync server, which also serves the built app and a small task API. Set `GR8R_TOKEN` to require a token on the task, project and priority APIs; `/api/state` and the app pages stay open, so bind it to a private interface such as your Tailscale address and never to 0.0.0.0.

```bash
npm run build
GR8R_HOST=$(tailscale ip -4) npm start     # http://<tailnet-ip>:8787, data in ~/.gr8r/state.json
```

`GR8R_HOST` (default 127.0.0.1), `GR8R_PORT` (default 8787) and `GR8R_DATA` (state file) configure it, and `GR8R_TOKEN` makes the task, project and priority APIs require `Authorization: Bearer <token>` (the CLI sends `GR8R_TOKEN` from its own environment). Instead of exporting variables you can put them in a `.env` file at the repo root, which is gitignored and read by both the server and the CLI; variables already set in the shell win, and `GR8R_ENV_FILE` points to a different file. The token does not cover `/api/rev` and `/api/state`, which the browser app uses without credentials, so it stops casual API use but not a deliberate write of the whole state; keep the server on a private interface. Open the app once so it saves its starting state, then the API accepts writes. Open tabs pick up changes made through the API within a few seconds.

The HTTP routes are listed in [api.md](api.md).

## CLI

The CLI wraps the same API. Point it at the server with `GR8R_URL`, and use `npm link` to get a `gr8r` command. Requests give up after 10 seconds; set `GR8R_TIMEOUT_MS` to change that.

```bash
export GR8R_URL=http://100.x.y.z:8787
gr8r add "write report" --priority high --cycle current
gr8r list --cycle current
gr8r set GR-3 --status progress
gr8r done GR-3
gr8r agent add Claude
gr8r comment GR-3 "tests pass" --as Claude
gr8r notify "needs your call" --task GR-3 --as Claude
gr8r inbox --unread
gr8r pr link GR-3 https://github.com/OWNER/REPO/pull/7
gr8r project add "Website" --key WEB --color teal
gr8r priority add Blocker --weight 5
gr8r priority rm low --replace medium
gr8r help
```

## Agents and the Inbox

Register an agent once with `gr8r agent add NAME`, then put `--as NAME` on a command (or export `GR8R_AGENT=NAME`) to log that write to the agent in comments and activity instead of you. This is attribution, not authentication: the one shared token still applies, and an unknown name is refused.

When an agent comments on or moves a task, you get an Inbox item. An agent can also raise one with `gr8r notify TEXT [--task KEY] [--type needs]`; use `--type needs` when it is blocked on you, and it shows on the Inbox "Needs you" tab. `gr8r pr link KEY URL` records a GitHub pull request on a task as a comment, and the task drawer shows an icon that opens it.
