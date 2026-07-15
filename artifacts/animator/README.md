# Animator (Danger Room / Play Shell)

**Live:** https://threejs-rapier-react-three-controll.vercel.app  
**Package:** `@workspace/animator-app` · **Engine:** plain three.js + Rapier

Grudge Studio **play shell**: third-person combat training, grudge6 races, voxel Explorer, doors to Realms / Characters / Dressing, Grudge ID on the landing page.

## About

- **Drive** characters: WASD walk, **Shift sprint**, jump, LMB attack, F skill, 1–4 signatures  
- **Grudge6 races** — modular Bip001 kits (armor/weapon mesh visibility + baked packs)  
- **Explorer** — procedural Mixamo weapon animation library  
- **Physics** — Rapier KCC / capsule depenetration vs room obstacles  
- **Root lock** — clips do not own world XYZ (stable blends, no meshing teleports)  
- **Fleet** — auth, characters, assets, multiplayer via production proxies  

Full connection map: [`../../docs/PRODUCTION.md`](../../docs/PRODUCTION.md).

## What you can do

- **Danger Room** combat sandbox + multiplayer hooks  
- **Minecraft-style armor** (`I`) — see `docs/minecraft-armor-equipment.md`  
- **Weapon skill kits** — F + 1–4 (mace2h exemplar + grudge kit aliases)  
- **Wildlife**, skillwrite casting, avatar hats — see `docs/`  
- **Doors hall** — Dressing, Realms (Mine-Loader), Characters GRUDOX  

## Run

```bash
pnpm --filter @workspace/animator-app run dev
pnpm --filter @workspace/animator-app run typecheck
pnpm --filter @workspace/animator-app run test
```

## Production deploy

```bash
# From artifacts/animator — use Vercel CLI session (not a stale VERCEL_TOKEN)
npx vercel deploy --prod --yes
```

Env template: `.env.production.example`  
Rewrites: `vercel.json`

## Architecture (three.js, not R3F)

| Module | Role |
|--------|------|
| `Studio.ts` | Scene owner, loop, weapons, skills |
| `Controller.ts` | Third-person move/camera + locomotion intent |
| `Character.ts` / `ExplorerCharacter.ts` / `grudge/GrudgeAvatar.ts` | Avatar implementations |
| `physics/capsuleKcc.ts` | Shared Rapier capsule KCC |
| `rig/rootLock.ts` | Bind-pose root XYZ freeze |

React (`Hud.tsx`, `LandingPage.tsx`, panels) is UI only.

## Production connections (summary)

| Service | Host |
|---------|------|
| Auth | id.grudge-studio.com |
| Characters / bag | grudge-api-production (Railway) |
| Assets | assets.grudge-studio.com |
| Danger API | gameopen-production (Railway) |
| Realms | mine-loader.vercel.app |

## Self-contained design

Does not import `@workspace/*` into the browser bundle for the core engine path; explorer/animator code lives under `src/three/`. Shared fleet helpers live in `lib/fleet-client` for launch URLs.
