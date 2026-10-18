# Personal server

The app works on its own from browser storage. To keep one copy of your data across browsers and devices, run the sync server, which also serves the built app and a small task API. Set `GR8R_TOKEN` to require a token on the task, project, priority, agent and notification APIs; `/api/state` and the app pages stay open, so bind it to a private interface such as your Tailscale address and never to 0.0.0.0.

```bash
npm run build
GR8R_HOST=$(tailscale ip -4) npm start     # http://<tailnet-ip>:8787, data in ~/.gr8r/state.json
```

`GR8R_HOST` (default 127.0.0.1), `GR8R_PORT` (default 8787) and `GR8R_DATA` (state file) configure it, and `GR8R_TOKEN` makes the task, project, priority, agent and notification APIs require `Authorization: Bearer <token>` (the CLI sends `GR8R_TOKEN` from its own environment). Instead of exporting variables you can put them in a `.env` file at the repo root, which is gitignored and read by both the server and the CLI; variables already set in the shell win, and `GR8R_ENV_FILE` points to a different file. The token does not cover `/api/rev` and `/api/state`, which the browser app uses without credentials, so it stops casual API use but not a deliberate write of the whole state; keep the server on a private interface. Open the app once so it saves its starting state, then the API accepts writes. Open tabs pick up changes made through the API within a few seconds.

The HTTP routes are listed in [api.md](api.md).

The command-line client is documented in [cli.md](cli.md).
