# Firearm animation production SSOT (P0–P2)

**Live host:** https://threejs-rapier-react-three-controll.vercel.app/  
**Pack root:** `artifacts/animator/public/anim/animations/{pistol,rifle,shotgun}/`  
**Clip map:** `explorer/clipCatalog.ts` → `WEAPON_SETS`  
**Verbs:** `explorer/clipRegistry.ts` (Gunslinger)  
**Combat:** `combat/gunCombat.ts` + `Studio` magazine / reload lock

## P0 — complete

| Deliverable | Location |
|-------------|----------|
| `ActionKey` reload / reloadEmpty / reloadTactical / reloadCrouch / shoot / pump / hipFire | `explorer/types.ts` |
| Pistol shoot + 4 reload variants | `animations/pistol/shoot.fbx`, `reload-*.fbx` |
| Rifle shoot + recoil + 4 reloads | `animations/rifle/shoot.fbx`, `recoil.fbx`, `reload-*.fbx` |
| Studio plays reload clip + locks fire | `beginGunReload()` |
| Rifle / hunter LMB uses shoot clip | `doGunPrimary()` |

## P1 — complete

| Deliverable | Location |
|-------------|----------|
| `WeaponClass` / `WeaponAnimSet` / `WeaponId` **shotgun** | types |
| Shotgun pack (loco + hip-fire + pump + reloads) | `animations/shotgun/*` |
| Arsenal weapon + skill kit | `arsenal/ranged.ts`, `SHOTGUN_SKILL_KIT` |
| Crouch reload selection | `pickReloadKind({ crouching })` |
| Pellet cone + post-shot pump | `doGunPrimary` |

## P2 — complete

| Deliverable | Location |
|-------------|----------|
| Empty vs tactical vs crouch durations | `gunMagazineSpec` |
| Tactical when `ammoInClip > 0` | `pickReloadKind` |
| Flash labels: RELOAD / TACTICAL RELOAD / CROUCH RELOAD / RELOADED | Studio |
| Drop-in FBX replace: keep **filename** stable | pack docs below |

## P3 — production feel (wiring / blend / deps)

| Deliverable | Location |
|-------------|----------|
| Snappy fire fade `0.05`, reload `0.14`, pump `0.08` | `GUN_BLEND` in `gunCombat.ts` |
| Moving fire = upper-body overlay; still = full-body | `Studio.playGunFireClip` + Explorer `playClipOverlay` |
| Fire lock rides real clip duration | `fireLockFromAnim` |
| R = manual reload on guns (tactical mid-mag) | `Studio.handleKey` KeyR |
| Tactical keeps HUD ammo until complete | `clearMagOnReloadStart` |
| Shotgun pump delay rides fire anim | `shotgunPumpDelayMs` |
| Blender MCP | GUI + addon Connect :9876 for mesh cleanup (optional) |
| ObjectStore / CDN weapons | `assets.grudge-studio.com/models/weapons/*` (200) |

## Clip filename contract (drop-in replace)

Replace file contents with real Mixamo (or studio) FBX **without renaming**:

### Pistol (`animations/pistol/`)
- `shoot.fbx` — fire cycle  
- `reload-standing.fbx` — default empty  
- `reload-empty.fbx` — long empty  
- `reload-tactical.fbx` — partial mag  
- `reload-crouch.fbx` — crouch  

### Rifle (`animations/rifle/`)
- `shoot.fbx`, `recoil.fbx`  
- `reload-standing.fbx`, `reload-empty.fbx`, `reload-tactical.fbx`, `reload-crouch.fbx`  

### Shotgun (`animations/shotgun/`)
- `hip-fire.fbx`, `shoot.fbx`, `pump.fbx`  
- same four `reload-*.fbx`  

Skeleton: **Mixamo 25-bone** (`mixamorig*`), rotation tracks preferred (see `retargetMixamoClip`).

## Current stand-in sources

Until dedicated Mixamo reloads are dropped in, packs ship **binary copies** of closest pistol Mixamo clips (same rig topology). Production wiring is complete; swap files to upgrade fidelity.

## Mesh notes (Blender MCP cleanup 2026-07-31)

Pipeline: import → join parts → merge-by-distance → consistent normals → SI length
to arsenal `model.length` → rotate barrel to arsenal `forward` → origin center → GLB.
Backups: `public/models/weapons/_backup_pre_blender_clean/`. Clean intermediates: `_clean/`.

| Mesh | Length (m) | Forward | Notes |
|------|------------|---------|--------|
| `revolver.glb` | 0.26 | x− | 710 v / 56 KB — production pistol prop |
| `pistol.glb` | 0.22 | y+ | blaster kit; arsenal primary still uses revolver |
| `rifle.glb` | 0.90 | z− | 40 parts → 1 mesh, 512 v / 74 KB |
| `shotgun.glb` | 0.85 | z− | Same stand-in as rifle lineage; **replace with real shotgun mesh** when available |
| `hunter-rifle.glb` | 0.95 | z− | SI + axis clean; meshopt+WebP **~110 KB** (was 4 MB) |

Runtime still uniform-fits longest axis to `piece.length` (`Weapons.ts`) — baked SI
makes scale ≈ 1 and keeps grip/forward stable.

## Manual QA

1. Equip **Pistol** → empty mag → **RELOAD** flash + reload clip → **RELOADED**.  
2. Mid-mag reload (if bound) → **TACTICAL RELOAD** (faster).  
3. Equip **Rifle** → LMB plays **shoot**, not frozen aim.  
4. Equip **Shotgun** → hip pellets + delayed **pump** + shell reload.  
5. Crouch while empty → crouch reload clip when crouch state is true.  
