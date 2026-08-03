# Conan-like feel — careful roadmap (this bar first)

**Product goal:** gameplay / physics / soft lock / control / harvest / camp that *feels* like Conan Exiles survival — not a 1:1 remake.

**Lab host:** `threejs-rapier-react-three-controller` Danger Room  
**Live:** https://threejs-rapier-react-three-controll.vercel.app/ (after intentional deploy)

## Phase status

| Phase | Scope | Status |
|-------|--------|--------|
| **A** | Control weight + soft lock + sprint stamina | **Done locally** |
| **B** | Outdoor body physics / colliders | **Lab done** — Rapier static cuboids on camp place + Controller obstacles |
| **C** | Harvest lab nodes + soft lock + melee stages | **Done locally** |
| **D** | Snap camp build + kenney GLB + blueprint browser | **Done locally** |
| **E** | Product surface (activity · tools · wallet HUD) | **Lab done** — survival HUD + modes |

## Controls (mode-gated — `activityInput.ts`)

| Key | combat | harvest | build |
|-----|--------|---------|-------|
| **B** | → build | → build | → combat |
| **U** | → harvest + wheel | toggle wheel | → harvest + wheel |
| **Esc** | cast cancel | wheel off / → combat | → combat |
| **LMB** | attack | harvest strike | place |
| **RMB** | hard lock | hard lock | remove |
| **R** | heavy / reload | — | rotate |
| **Y** | — | — | cycle piece |
| **1–4** | skills | tools | — |
| **X / C / E / F** | dodge / parry / block / skill | dodge + block only | — |
| **K** | 1P/3P | 1P/3P | 1P/3P |
| **Space** | jump | jump | jump |

SSOT: `three/activityInput.ts` · Studio dispatches only · tests in `activityInput.test.ts`.

## Phase D — kenney pack + browser

| Piece | Implementation |
|-------|----------------|
| Assets | `public/models/kenney/prototype/*.glb` (curated from Kenney Prototype Kit) |
| Catalog | `camp/kenneyCatalog.ts` |
| Snap lab | `camp/CampLab.ts` — 1 m pad, GLB load + box fallback |
| Browser | `SurvivalHud` left panel when **B** on |
| Wallet | Seed + harvest drops; costs per piece |

## Tool wheel / Open harvestTools

| Piece | Implementation |
|-------|----------------|
| SSOT | `game/inventory/harvestTools.ts` (aligned with Open) |
| Match | axe→wood · pick→stone · wrong tool weak mul |
| Wheel | **U** + HUD cards · craft from wallet |
| Seed | Hatchet + pickaxe auto-crafted once for offline lab |

## Phase B — physics

| Piece | Implementation |
|-------|----------------|
| Camp place | `PhysicsSystem.addStaticCuboid` when Rapier ready |
| Move push-out | `Controller.setObstacles` circles (room + harvest + camp) |
| Not yet | Full outdoor trimesh island / Open map surface |

## Phase E — product surface

| Piece | Implementation |
|-------|----------------|
| Modes | `combat` · `harvest` · `build` on Studio + HUD |
| Wallet strip | Top-center survival strip |
| Hints | B build · U tools on player frame |

## Verify (local)

1. Wallet strip shows W/S/F/O  
2. **U** → tool wheel; **1** hatchet · **2** pick  
3. Chop trees (axe) vs rocks (pick); wrong tool flashes  
4. **B** → blueprint list + kenney ghost; LMB place GLB  
5. Walk into wall → obstacle / Rapier block  
6. Esc / B off → combat LMB  

## Deploy

Still **local** until intentional Vercel push. Note: `file:` `@grudge-studio/*` needs monorepo path or published packages on CI.

## SSOT map

| Feel | Code |
|------|------|
| Soft / hard lock | Controller + Targets.acquireSoftLock |
| Stamina | epicfight `drainStamina` |
| Harvest nodes | `harvest/HarvestLab.ts` |
| Tools | `game/inventory/harvestTools.ts` |
| Camp / kenney | `camp/CampLab.ts` + `kenneyCatalog.ts` |
| HUD surface | `components/SurvivalHud.tsx` |
| Combo hit frames | Studio OPENER/COMBO/FINISHER fracs |
