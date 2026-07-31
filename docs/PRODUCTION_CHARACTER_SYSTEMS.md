# Production character systems (unified)

**Live:** https://threejs-rapier-react-three-controll.vercel.app  
**Avatar door:** `/` → Avatar Edit (mode `avatar`)

## What was separated (now joined)

| Layer | Module | Production store |
|-------|--------|------------------|
| Cube face (AV1) | `three/avatar/catalog.ts` | `avatarEdit:playerHead:v1` |
| Head on Explorer | `three/avatar/playerHead.ts` | applied in `explorer/rig.ts` |
| Body scale / role | `three/avatar/npcPrefab.ts` | AVP1 + prefab library |
| Armor 4-slot | `three/equipment/*` | `animator.armorLoadout.v1` |
| Armor stand preview | `equipment/armorStand.ts` | Fitting Room stage |
| Weapons | `three/arsenal/*` | Studio `weaponId` / offHand |
| Voxel body colours | `explorer/voxelAvatarSave.ts` | `avatarEdit:voxelLook:v1` |
| Race gear presets | `three/grudge/gearPresets.ts` | prefab `gearPresetId` |
| **Unified SSOT** | **`three/avatar/productionLoadout.ts`** | **`grudge.productionLoadout.v1`** |

## User flow (production)

1. **Avatar Edit → Face** — race + modular face (`AV1.…` code).
2. **Fitting Room** — height/bulk (SI m), armor set, weapons, role, gear preset.  
   Live **armor stand mannequin** appears next to the head.
3. **Save to character** or **Save prefab** — writes:
   - player head  
   - armor storage  
   - **production loadout** (all fields + `prefabCode`)  
   - prefab library entry (when Save prefab)
4. **Prefabs tab** — generate NPC/enemy/ally/vendor/boss squads; export JSON for fleet.
5. **Enter Danger / Play** — `App` hydrates weapon + off-hand + armor from production loadout.

## Codes

| Prefix | Use |
|--------|-----|
| `AV1.` | Face only (share looks) |
| `AVP1.` | Full deploy prefab (face + body + gear) |

Import either on Avatar Edit → Import.

## Deploy checklist

```bash
# From monorepo root
cd artifacts/animator
pnpm run build
npx vercel deploy --prod --yes --scope grudgenexus
# or push main if GitHub→Vercel is linked
```

Env: see `docs/PRODUCTION.md` + `.env.production.example`.

### Smoke

1. Avatar Edit → Fitting Room → equip Iron + weapon → Save to character  
2. Hard refresh → enter Danger → weapon/armor match  
3. Prefabs → Squad ×5 → Export JSON downloads  
4. Import your `AV1.eyJ…` barbarian → Fitting → Save prefab  

## Fleet handoff

`exportPrefabsJson` emits `grudge.characterPrefab.v1` for Mine-Loader / Railway NPC seeds.  
Wire consumers via `listProductionSpawnPrefabs()` / AVP1 decode.

### Danger Room production spawn

| API | Module |
|-----|--------|
| `prefabToSpawnSpec` / `listProductionSpawnSpecs` | `productionLoadout.ts` |
| `Studio.spawnFromProductionSpec` / `spawnProductionPrefabs` | `Studio.ts` |
| Admin → **Spawn production prefabs (AVP1)** | `AdminPanel` |
| AI tool `spawn_production_prefabs` | `dangerTools.ts` |

Enemies/bosses spar as **enemy** faction; allies/NPCs/vendors/player roles as **ally**. Scale from SI `heightM / 1.8`.
