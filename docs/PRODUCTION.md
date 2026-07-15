# Production environment & connections

**Live URL:** https://threejs-rapier-react-three-controll.vercel.app  
**GitHub:** https://github.com/MolochDaGod/threejs-rapier-react-three-controller  
**Vercel root:** `artifacts/animator`

## About (product)

Grudge Studio **play shell**: Animator / Danger Room combat sandbox, grudge6 modular races, voxel Explorer, doors hall (Dressing, Realms, Characters), Grudge ID auth, and fleet proxies to Railway + R2.

## Connection matrix

| Path on this host | Upstream | Purpose |
|-------------------|----------|---------|
| `/api/auth/*`, `/login` | `id.grudge-studio.com` | Grudge ID / SSO |
| `/api/characters*`, `/api/account/*`, `/api/wallet*`, `/api/nfts*`, `/api/inventory/*`, `/api/island/*` | `grudge-api-production-0d46.up.railway.app` | Characters, bag, wallet |
| `/api/objectstore/*` | `objectstore.grudge-studio.com` | Asset registry |
| `/api/space`, `/api/brawl`, `/api/carrier` | `voxgrudge-grudox-room-production.up.railway.app` | GRUDOX rooms / carrier |
| `/api/danger` | `gameopen-production.up.railway.app` | Danger multiplayer |
| `/api/blocks*`, `/api/worlds*`, `/api/lobby*`, `/api/me`, … | `mine-loader.vercel.app` | Mine-Loader Realms |
| `/api/*` (fallback) | `gameopen-production.up.railway.app` | Generic game API |
| Static models / anims | same-origin `public/` and/or R2 | three.js assets |

Config source of truth: `artifacts/animator/vercel.json`.

## Vercel Production env vars

Set in Vercel → Project → Settings → Environment Variables → **Production**:

| Name | Suggested value |
|------|-----------------|
| `VITE_MINELOADER_URL` | `https://mine-loader.vercel.app` |
| `VITE_ASSET_BASE_URL` | *(empty)* or `https://assets.grudge-studio.com` |
| `VITE_GAME_SERVER_URL` | *(empty for same-origin danger)* or `wss://…` dedicated |
| `VITE_GAME_API_URL` | *(empty — use `/api` proxy)* |

Optional:

| Name | When |
|------|------|
| `VITE_CLERK_PUBLISHABLE_KEY` | Clerk UI path |
| `VITE_CLERK_PROXY_URL` | Clerk proxy |

Copy template: `artifacts/animator/.env.production.example`.

## Deploy

```bash
# From repo root — clear invalid tokens first
Remove-Item Env:VERCEL_TOKEN -ErrorAction SilentlyContinue

cd artifacts/animator
npx vercel pull --yes --environment=production   # optional: sync env
npx vercel deploy --prod --yes
```

Or push to `main` if GitHub integration is enabled for this project.

## Smoke test after deploy

```bash
curl -sI https://threejs-rapier-react-three-controll.vercel.app/ | head -5
curl -sI https://threejs-rapier-react-three-controll.vercel.app/api/characters | head -5
# Expect 200/401 from Railway proxy, not Vercel 404 HTML
```

In browser:

1. Landing → Grudge ID or guest  
2. Doors → Danger / play grudge6 character  
3. WASD walk, **Shift** sprint (not walk-scaled run)  
4. F / 1–4 skills fire VFX + attack motion  
5. Character does not mesh through room obstacles  

## Related fleet URLs

| Surface | URL |
|---------|-----|
| Mine-Loader | https://mine-loader.vercel.app |
| Gameopen / Dressing | https://gameopen.vercel.app |
| Warlords | https://grudgewarlords.com |
| Assets | https://assets.grudge-studio.com |
| ID | https://id.grudge-studio.com |
