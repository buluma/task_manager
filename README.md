# Gr8r Studio

A calm, structured project management workspace: home dashboard, inbox, my tasks, projects with board / list / table / calendar / timeline / files views, members, teams, activity and settings. Built with plain JavaScript ES modules and CSS, bundled by [Vite](https://vite.dev). There is no UI framework and no runtime dependency.

![Gr8r Studio home dashboard](docs/preview.png)

## Getting started

Requires Node.js 18 or newer (`.nvmrc` pins 22).

```bash
npm install
npm run dev       # http://localhost:5173 with hot reload
npm run build     # production build in dist/
npm run preview   # serve the production build locally
npm test          # server, CLI and core unit tests (node --test)
npm run lint      # ESLint
npm run format    # Prettier
```

## Docs

- [Architecture](docs/architecture.md): project structure, layers and conventions.
- [Personal server](docs/server.md): the sync server and its configuration.
- [CLI](docs/cli.md): every `gr8r` command, plus agents and the Inbox.
- [HTTP API](docs/api.md): every route.

## CI and deploy

Every push and pull request runs lint, the format check, the tests and a production build (`.github/workflows/ci.yml`). `vercel.json` builds with Vite and serves `dist/`.
