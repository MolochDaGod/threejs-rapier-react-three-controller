# Animator (Danger Room / production controller)

**Live:** https://threejs-rapier-react-three-controll.vercel.app/  
**Package:** `@workspace/animator-app` · **Engine:** plain three.js + Rapier

Third-person **animation + combat studio** (X-Men-style Danger Room), voxel tools,
Dressing Room, and **Ethereal Falls** 4-slot account character select.

## Production character policy

| Source | What players see |
|--------|------------------|
| **Campfire** (post sign-in) | Up to **4 account** heroes (fleet / charactersgrudox) |
| **Admin / Playground picker** | Curated production cast only (`PLAYABLE_CHARACTERS`) |

**Not in production pickers:** Sensei (`karate-boss`), the **24 grudge6** race×class
prefabs, ikkau/demo names, licensed lab-only skins.

Default guest shell: **Explorer**. Fleet ids that map to removed kits resolve safely to Explorer.

## Combat hotkeys

| Key | Action |
|-----|--------|
| WASD · Shift | Move · sprint |
| Space | Jump |
| LMB · RMB | Attack · soft/hard lock |
| Ctrl hold · C | Block · parry |
| Q | Parry / loadout swap (hold: radial where enabled) |
| F · 1–4 · R | Weapon skill · signatures · special |
| I | Equipment |
| Tab | Cycle target |

Full SSOT: [`docs/PRODUCTION_CONTROLLER.md`](../../docs/PRODUCTION_CONTROLLER.md).

## Weapon skills · VFX · hip / anim

- Signature slots play **clip + VFX**; staffs use elemental casts; post **bloom** for spells  
- **Hip grounding:** Mixamo/Explorer use `lockHorizontalRoot`; combat one-shots do **not** clamp on bent end frames (avoids look-down-through-terrain)  
- Feet plant via grounder / dungeon sampler; bipeds feet-on-terrain, not forced on custom non-human rigs  

## Run

```bash
pnpm --filter @workspace/animator-app run dev
pnpm --filter @workspace/animator-app run typecheck
pnpm --filter @workspace/animator-app run build
```

## Architecture (three.js, not R3F)

- `src/three/Studio.ts` — scene, combat, skills, loop  
- `src/three/Controller.ts` — third-person camera + movement  
- `src/three/assets.ts` — production `PLAYABLE_CHARACTERS` + weapons  
- `src/components/CampfireLobby.tsx` — Ethereal Falls 4-slot select  
- `src/auth/fleetCharacter.ts` · `grudoxRoster.ts` — account SSOT  
- `src/three/explorer/` — procedural rig, clip bank, hip lock  

React is HUD/UI only; the engine owns the canvas.

## Entry modes

| `?door=` | Surface |
|----------|---------|
| *(default)* | Landing → campfire characters |
| `characters` | Ethereal Falls campfire |
| `danger` | Danger Room combat |
| `editor` | Dressing Room |
| `voxel` · `lobby` · `avatar` · `ledmask` | World editor · multiplayer · avatar · LED mask |

## Armor

Minecraft-style slots (head / chest / legs / feet) — see `docs/minecraft-armor-equipment.md`.
