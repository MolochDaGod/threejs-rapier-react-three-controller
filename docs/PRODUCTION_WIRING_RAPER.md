# threejs-rapier production wiring (no parallel stacks)

**Live:** https://threejs-rapier-react-three-controll.vercel.app/  
**Package:** `artifacts/animator` · Vercel project `threejs-rapier-react-three-controll`

This document freezes how the satellite app **connects** to existing Grudge production systems. Edits must wire into these — not replace them.

## One-truth map

```
Browser (this Vercel SPA)
  │
  ├─ Puter SDK (js.puter.com/v2)     →  temporary identity / guest cloud
  │       │
  │       └─ POST /api/auth/puter-sso|puter  (same-origin rewrite)
  │                 → id.grudge-studio.com → Railway grudge-api-production
  │                 → JWT + grudgeId  (Postgres users/accounts)
  │
  ├─ Web SSO (optional)              →  id.grudge-studio.com/login?redirect_uri=
  │       └─ return ?sso_token=      →  captureSsoFromUrl → FLEET_TOKEN_KEYS
  │
  ├─ GET/POST /api/characters*       →  Railway Postgres characters
  ├─ /api/account/*                  →  Railway account bag / GBUX
  ├─ /api/treaty|fleet|health        →  Railway (fleet satellite set)
  ├─ /api/danger|space|…             →  gameopen / GRUDOX rooms (unchanged)
  ├─ Foundry create                  →  character.grudge-studio.com
  └─ Binaries                        →  assets.grudge-studio.com (R2)
```

| Do | Don’t |
|----|--------|
| Extend `vercel.json` rewrites before catch-all | Point auth at `api.grudge-studio.com` |
| Store JWT in `FLEET_TOKEN_KEYS` only | Invent a second character table or D1 roster |
| Set `grudge_id` from Railway `grudgeId` only | Write Puter UUID as `grudge_id` |
| Keep Campfire at `?door=campfire` | Delete CampfireLobby when shipping airship |
| Deploy to project `threejs-rapier-react-three-controll` | Overwrite unrelated Vercel projects (`animator`, `gameopen`) |

## Modes (product surfaces)

| Mode | Door | Role |
|------|------|------|
| `landing` | default / `?door=landing` | Puter + Grudge ID + account connection status |
| `characters` | `?door=characters` | **The Grudge** airship 4-crew (production) |
| `campfire` | `?door=campfire` | Ethereal Falls (kept; same fleet roster) |
| `danger` / editors | existing doors | Unchanged game surfaces |

## Schema / database

- **No schema migration in this repo.** Characters and accounts live in Railway Postgres (`grudge-api-production`).
- Client only reads/writes via `/api/*` with `Authorization: Bearer <jwt>`.
- Local keys (`animator.lobby.roster.v1`, `grudge.activeCharId`) are **cache / handoff**, not SSOT.

## Deploy (avoid overwrite conflicts)

1. **Canonical production project:** `grudgenexus/threejs-rapier-react-three-controll`  
   Alias: `threejs-rapier-react-three-controll.vercel.app`
2. **Root Directory (Vercel):** `artifacts/animator` (monorepo root checkout).
3. **Install:** `cd ../.. && corepack enable && pnpm install --frozen-lockfile`  
   (required for pnpm `catalog:` + workspace packages).
4. **Build:** `pnpm run build` → `dist/public`.
5. Do **not** re-link local CLI to `animator` or other projects when shipping this URL.
6. Unrelated dirty work (combat stacks, epicfight) stays out of production commits unless intentional.

## Smoke

```text
GET  /api/health          → Railway healthy (via rewrite)
POST /api/auth/puter-sso  → JWT when Puter uuid sent
GET  /api/characters      → Bearer list (era=warlords preferred)
GET  /backgrounds/scene_airship.png → 200
```
