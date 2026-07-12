---
name: Railway game-server hosting
description: How the Animator realtime game backend is hosted on Railway, and the RAILWAY_API_TOKEN quirks.
---

# Railway game-server hosting

The space/carrier/danger WebSocket relays run as a dedicated always-on Railway
service, decoupled from both the api-server and the Replit web deployment. Railway
injects `PORT` and fronts the service with an auto-TLS HTTPS domain, so the browser
gets `wss` for free — this is why we pivoted here from a bare-IP Ubuntu VPS (a bare
IP can't easily get a cert for `wss`, and that VPS was unreachable anyway).

## Deploy shape
- Deploy a **minimal self-contained dir**, not the monorepo: `dist/game-server.mjs`
  (+ pino worker siblings) + a tiny `package.json` (`start: node game-server.mjs`,
  no deps) + a `nixpacks.toml` that no-ops install/build. Nixpacks then just runs node.
- `railway up` from that dir uploads + builds + deploys. Reproducer:
  `artifacts/api-server/deploy-railway.sh` (needs a project token in `RAILWAY_TOKEN`).
- Identifiers (not secrets): project `animator-game-server`
  `a059c085-21f6-462f-a195-660d68967434`, service `game-server`
  `09ee4156-45cd-4047-8f8c-2d7cd24c1388`, domain
  `game-server-production-b263.up.railway.app`.

## RAILWAY_API_TOKEN is a TEAM token (the confusing part)
- It is UUID-shaped (36 chars) but is **not** a project token and **not** a personal
  token. As a result:
  - `Authorization: Bearer $RAILWAY_API_TOKEN` on `backboard.railway.app/graphql/v2`
    **works for team-scoped queries/mutations** (`projects`, `projectCreate`,
    `serviceCreate`, `projectTokenCreate`, `serviceDomainCreate`).
  - The same token **fails** `me` ("Not Authorized"), and the Railway CLI
    `whoami` / `list` / `RAILWAY_TOKEN=...` all reject it. Don't waste time on CLI
    auth with it.
- **How to actually deploy:** use the team token via GraphQL to create the project +
  service, then `projectTokenCreate` a real **project token**, set it as
  `RAILWAY_TOKEN`, and run `railway up` (the CLI only accepts a project token here).
- A project token never needs to be printed/committed — capture it to a 600-mode
  file and reference it.

**Why:** several auth dead-ends here look like "the token is invalid" when it's
really just the wrong token *type* for that call. Always reach for the GraphQL
`projects` query first to confirm the team token still works.
