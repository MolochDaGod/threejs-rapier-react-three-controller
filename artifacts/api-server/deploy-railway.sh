#!/usr/bin/env bash
#
# Redeploy the standalone Animator game server to Railway.
#
# The game server (src/game-server.ts -> dist/game-server.mjs) is a self-contained
# bundle: bare http.Server + the three WebSocket relays (/api/space, /api/carrier,
# /api/danger) and a /healthz endpoint. No db / clerk / express, no runtime deps.
#
# Railway injects PORT and serves the service over an HTTPS/TLS domain, so the
# browser reaches it over wss automatically.
#
# Prereqs:
#   - Railway CLI:        npm i -g @railway/cli
#   - RAILWAY_TOKEN env:  a Railway *project token* for the "animator-game-server"
#                         project (create one in the project's Settings -> Tokens).
#
# Live URL: https://game-server-production-b263.up.railway.app
# Client targets it via the VITE_GAME_SERVER_URL env var (wss://<domain>).
#
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
SERVICE_ID="09ee4156-45cd-4047-8f8c-2d7cd24c1388" # "game-server" service

if [ -z "${RAILWAY_TOKEN:-}" ]; then
  echo "error: RAILWAY_TOKEN (project token) must be set in the environment." >&2
  exit 1
fi

# 1. Build the standalone bundle (also builds the express server entrypoint).
pnpm --filter @workspace/api-server run build

# 2. Assemble a minimal deploy dir: bundle + pino worker siblings + manifest.
DEPLOY="$(mktemp -d)"
trap 'rm -rf "$DEPLOY"' EXIT
cp "$ROOT/dist/game-server.mjs" "$DEPLOY/"
cp "$ROOT/dist/"pino-*.mjs "$ROOT/dist/thread-stream-worker.mjs" "$DEPLOY/" 2>/dev/null || true

cat > "$DEPLOY/package.json" <<'JSON'
{
  "name": "animator-game-server",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": { "start": "NODE_ENV=production node game-server.mjs" },
  "engines": { "node": "20" }
}
JSON

cat > "$DEPLOY/nixpacks.toml" <<'TOML'
providers = ["node"]

[phases.install]
cmds = ["echo 'no dependencies to install (self-contained bundle)'"]

[phases.build]
cmds = ["echo 'no build step (prebuilt bundle)'"]

[start]
cmd = "NODE_ENV=production node game-server.mjs"
TOML

# 3. Upload + deploy.
( cd "$DEPLOY" && railway up --service "$SERVICE_ID" --detach )

echo "Deployed. Public URL: https://game-server-production-b263.up.railway.app"
