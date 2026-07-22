# Production Controller SSOT

**Live:** https://threejs-rapier-react-three-controll.vercel.app/  
**Repo:** `MolochDaGod/threejs-rapier-react-three-controller` · package `@workspace/animator-app`

## Product cast (what ships in the picker)

| Included | Role |
|----------|------|
| Explorer · LED Monk | Procedural voxel / guest shell |
| Racalvin · Brute · Striker · Tera-Kasi | GLB combat exemplars |
| Archmage · Soulbinder · Tank | Procedural weapon-skill kits |

| **Removed from production** | Why |
|-----------------------------|-----|
| **Sensei** (`karate-boss`) | Unintended lab cast |
| **24 grudge6 race×class prefabs** | Not account heroes; cluttered Admin/Dressing pickers |
| **ikkau / demo names** | Filtered in campfire roster + `getCharacter` |
| Spider-Gwen · Iron Spider · Numbuh 1 | Licensed lab-only |

**Account heroes** use the **Ethereal Falls campfire** (4 slots) after Grudge ID sign-in — Railway fleet + `animator.lobby.roster.v1`, not a fixed 24-kit grid.

## Entry flow

```
Landing (Grudge ID) → characters (campfire 4-slot) → Danger / doors / play
Deep-link: ?door=characters | danger | editor | avatar | …
```

## Combat hotkeys (Danger Room)

| Input | Action |
|-------|--------|
| **WASD** | Move (camera-relative) |
| **Shift** | Sprint |
| **Space** | Jump / double-jump |
| **LMB** | Primary attack / combo |
| **RMB** | Soft/hard lock focus |
| **Ctrl** (hold) | Block |
| **C** | Parry window |
| **Q** (tap) | Parry / loadout cycle when kit has 2 weapons |
| **Q** (hold) | Mode / radial (where enabled) |
| **E** | Interact / block assist |
| **F** | Weapon skill |
| **1–4** | Signature skills (clip + VFX) |
| **R** | Skyfall / special |
| **Tab** | Cycle soft-lock target |
| **I** | Equipment / armor |
| **Esc** | UI / unlock pointer |

Touch: on-screen move/look pads mirror the same combat graph.

## Weapon skills · effects · animation

- **Arsenal** (`three/arsenal/*`) — hold styles, colliders, elemental staffs  
- **Signature path** — `Studio` skill slots → clip one-shot + VFX (`Vfx.ts`, post bloom)  
- **Post FX** — `three/fx/postfx.ts` combat / spell / cinematic presets (bloom required for spells)  
- **Procedural kits** — Archmage / Soulbinder / Tank bespoke `doArcaneSig` / `doTankSig`  
- **Kick kits** — Striker / Tera-Kasi native + optional FBX kick clips  

## Hip / grounding (production)

| Layer | Behaviour |
|-------|-----------|
| **Explorer / Mixamo** | `lockHorizontalRoot` re-baselines hip XZ + Y to bind pose; strips authored hip translation drift |
| **Character GLB one-shots** | `clampWhenFinished = false` on combat one-shots — no frozen bent end-pose / look-through-terrain |
| **Feet** | Foot grounder + optional ground sampler (dungeon); bipeds plant feet, flyers use altitude |
| **Spawn** | Height normalize to `CHARACTER_HEIGHT_M` (~2 m), min.Y → floor |

Do **not** force biped hip strip on custom animals / non-human bosses with their own skeletons.

## Deploy

```bash
cd threejs-rapier-react-three-controller
pnpm install
pnpm --filter @workspace/animator-app run build
# Vercel project: threejs-rapier-react-three-controll → production
```

Env: fleet token keys, optional `VITE_GAME_API_URL`, `VITE_ASSET_BASE_URL`.

## Related

- `docs/PRODUCTION_COMBAT_UX_SSOT.md` — HUD / soft-lock / postfx  
- Campfire: `components/CampfireLobby.tsx` · `three/intro/CampfireLobbyScene.ts`  
- Fleet: `auth/fleetCharacter.ts` · `auth/grudoxRoster.ts`
