# Grudge Studio — Play Shell (Animator / Danger Room)

**Production:** https://threejs-rapier-react-three-controll.vercel.app  
**Fleet alias:** open.grudge-studio.com (when DNS points here)  
**Repo:** [MolochDaGod/threejs-rapier-react-three-controller](https://github.com/MolochDaGod/threejs-rapier-react-three-controller)

Browser play shell for **Grudge Studio**: third-person combat, grudge6 modular races, voxel Explorer, Danger Room, Realms / Mine-Loader, and fleet auth — plain **three.js** + **Rapier**, React HUD only.

## About

This monorepo ships the **Animator** app (artifact `artifacts/animator`): a training / play shell where you:

- Sign in with **Grudge ID** (or guest)
- Drive **procedural Explorer** (Mixamo weapon packs) or **grudge6 race kits** (Bip001 + armor/weapon mesh visibility)
- Fight in the **Danger Room**, open **Dressing / doors**, Realms (Mine-Loader), Characters GRUDOX
- Use weapon skills (F + 1–4), Rapier KCC physics, root-locked locomotion (walk / Shift-sprint)

**Not** React Three Fiber: `Studio.ts` owns the renderer, scene, and loop; React renders overlays only.

## Production connections

| Concern | Endpoint |
|---------|----------|
| **This app (Vercel)** | `https://threejs-rapier-react-three-controll.vercel.app` |
| **Auth (Grudge ID)** | `https://id.grudge-studio.com` — rewrites `/api/auth/*`, `/login` |
| **Characters / account bag** | Railway `grudge-api-production-0d46` — `/api/characters`, `/api/account/*` |
| **ObjectStore** | `https://objectstore.grudge-studio.com` — `/api/objectstore/*` |
| **Assets CDN (R2)** | `https://assets.grudge-studio.com` (grudge6 FBX/GLB, atlases, baked anims) |
| **Danger multiplayer** | Railway `gameopen-production` — `/api/danger`, fallback `/api/*` |
| **GRUDOX room / carrier** | Railway `voxgrudge-grudox-room-production` — `/api/space`, `/api/brawl`, `/api/carrier` |
| **Mine-Loader Realms** | `https://mine-loader.vercel.app` — blocks/worlds/lobby proxies |
| **Warlords** | `https://grudgewarlords.com` |
| **Dressing / Open** | `https://gameopen.vercel.app` |

Same-origin **Vercel rewrites** in `artifacts/animator/vercel.json` keep cookies and avoid browser CORS for fleet APIs.

```
Browser (this shell)
  ├── Auth ──────────► id.grudge-studio.com
  ├── Characters ────► grudge-api-production (Railway)
  ├── Assets ────────► assets.grudge-studio.com (R2)
  ├── ObjectStore ───► objectstore.grudge-studio.com
  ├── Danger / API ──► gameopen-production (Railway)
  ├── GRUDOX rooms ──► voxgrudge-grudox-room-production
  └── Realms ────────► mine-loader.vercel.app
```

## Production environment

Build-time env (Vercel project **Production**). Prefer proxies in `vercel.json` over baking absolute API hosts.

| Variable | Production value / note |
|----------|-------------------------|
| `VITE_MINELOADER_URL` | `https://mine-loader.vercel.app` |
| `VITE_ASSET_BASE_URL` | leave empty for same-origin `public/`; or `https://assets.grudge-studio.com` for CDN-first |
| `VITE_GAME_SERVER_URL` | optional WSS for dedicated game server; unset → same-origin `/api/danger` |
| `VITE_GAME_API_URL` | optional; default same-origin `/api` → Railway |
| `VITE_CLERK_PUBLISHABLE_KEY` | only if Clerk path is enabled (Grudge ID Puter is primary) |
| `BASE_PATH` | `/` on this project |

See `artifacts/animator/.env.production.example` and `docs/PRODUCTION.md`.

**No Replit.** Fleet policy: Vercel + Railway + Cloudflare only (`docs/NO_REPLIT.md`).

## Recent production fixes (grudge6)

- **Walk vs Shift-sprint** — dedicated sprint clip; walk no longer promoted to run
- **Root lock + hips between feet** — controller owns world XYZ; kit centered for capsule
- **Weapon skills** — signature kit labels + clip aliases → baked attack
- **Studio spawn** — catalog `def` always resolved for loadout / skills

## Artifacts

| Artifact | Path | Role |
|----------|------|------|
| **Animator** | `artifacts/animator` | Deployed play shell at `/` |
| **API server** | `artifacts/api-server` | Express (optional self-host; prod uses Railway fleet) |
| **mockup-sandbox** | `artifacts/mockup-sandbox` | Internal UI previews |

## Stack

- **pnpm** workspaces, TypeScript, **Vite**
- **three.js** + **@dimforge/rapier3d**
- **React 19** HUD only
- **Vercel** (frontend) · **Railway** (API / multiplayer) · **R2/D1** (assets)

## Local run

```bash
pnpm install
pnpm --filter @workspace/animator-app run dev
# http://localhost:3000
```

```bash
pnpm run typecheck
pnpm --filter @workspace/animator-app run test
```

## Deploy (production)

```bash
cd artifacts/animator
# Use CLI login (do not set a stale VERCEL_TOKEN)
npx vercel deploy --prod --yes
```

Root Directory on Vercel should be `artifacts/animator` (or monorepo with that as the linked app).  
GitHub → Vercel: push `main` to auto-deploy when the project is linked.

## Repository layout

```
artifacts/animator/   # play shell (vercel.json rewrites + Vite app)
artifacts/api-server/ # optional Express
lib/                  # shared packages (fleet-client, vfx, animator, …)
docs/                 # production, fleet, no-replit
```

## Related docs

- [`docs/PRODUCTION.md`](./docs/PRODUCTION.md) — env, rewrites, smoke tests  
- [`docs/NO_REPLIT.md`](./docs/NO_REPLIT.md) — self-host policy  
- [`docs/FLEET-CHARACTER-MERGE.md`](./docs/FLEET-CHARACTER-MERGE.md) — grudge6 + GRUDOX characters  
- [`artifacts/animator/README.md`](./artifacts/animator/README.md) — animator feature guide  
