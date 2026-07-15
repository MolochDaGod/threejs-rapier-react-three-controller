# No Replit policy (fleet self-host)

This play shell and all fleet games deploy on **Vercel + Railway + Cloudflare R2/D1** only.

See also **[PRODUCTION.md](./PRODUCTION.md)** for full env + rewrite matrix.

| Concern | Host |
|---------|------|
| Play shell | `threejs-rapier-react-three-controll.vercel.app` · open.grudge-studio.com |
| Mine-Loader Realms | `https://mine-loader.vercel.app/` |
| Auth | id.grudge-studio.com |
| Characters / account | Railway grudge-api-production |
| Assets | assets.grudge-studio.com (R2) |
| Danger multiplayer | gameopen-production (Railway) |
| GRUDOX rooms | voxgrudge-grudox-room-production |

## Forbidden

- `*.replit.app`, `*.replit.dev`, `*.repl.co`
- Embedding Replit previews in iframes
- Default API / world URLs pointing at Replit

## Realms iframe

`MineGrudgeEditorMode` may iframe **only**:

1. Live: `https://mine-loader.vercel.app/` (our Vercel)
2. Local: same-origin `/minegrudge/` staged client

## Env

```
VITE_MINELOADER_URL=https://mine-loader.vercel.app
```

Redeploy this repo after URL changes so production bundles drop any baked Replit strings.
