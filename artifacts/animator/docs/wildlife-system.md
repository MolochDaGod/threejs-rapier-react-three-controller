# Wildlife system (Quirky animals pack)

## Asset

| Path | Source |
|------|--------|
| `public/models/wildlife/quirky-animals.glb` | `D:\Games\Models\quirky_series_-_free_animals_pack.glb` |

Packed multi-species GLB (LOD1 roots). Single `Scene` animation; tracks are filtered per animal with `filterBindableTracks`.

## Species (all used)

| Id | Node | Habitat | Temperament | Products |
|----|------|---------|-------------|---------|
| colobus | Colobus_LOD1 | land | skittish | meat + hide |
| gecko | Gecko_LOD1 | land | docile | tiny meat + scale |
| herring | Herring_LOD1 | aquatic | skittish | fish (spawn off by default) |
| inkfish | Inkfish_LOD1 | aquatic | docile | fish + ink |
| muskrat | Muskrat_LOD1 | land | docile | meat + pelt |
| pudu | Pudu_LOD1 | land | skittish | venison + hide |
| sparrow | Sparrow_LOD1.001 | aerial | skittish | bird meat + feathers |
| taipan | Taipan_LOD1 | land | predator | meat + snake skin + venom |

Danger Room auto-spawns **land + aerial** only (~10). Aquatic need water / `includeAquatic`.

## Behaviour

| State | Meaning |
|-------|---------|
| idle / graze | Stand, slow anim |
| wander | A* path on `NavGrid` (or flat XZ if no nav) |
| flee | Away from player when detected / hurt |
| dead | Tip to side (~0.55s), corpse **120s** |

## Harvest + skeleton residual

- **KeyN** near a corpse (within ~2.2 m)
- Rolls meat + leather (+ optional extra)
- On butcher **or** after **120s** unskinned: flesh mesh is replaced by **Skeletons_Free** residual (`models/skeletons/Skeleton.glb`)
- Skeleton lingers ~**90s**, then despawns
- See `src/three/corpse/SkeletonCorpse.ts` and GrudgeBuilder doc `docs/WARLORDS_CREATURES_TRAPS_SKELETONS.md`

## Dungeon traps (related)

- Multipack `models/obstacles/mobile_game_obstacles.glb` seeded via `DungeonHazards.ts` (surface + pit)
- New GLB enemies: drake / ifrit / lava_golem / free_reptile / thorn_beast / armored_crab (`DungeonEnemies.ts`)

## Pathfinding

Reuses `dungeon/navmesh` (`findPath`, `heightAt`, `nearestWalkable`).  
`Studio.bindWildlifeNav(nav)` when entering dungeon/island.

## Code

| Module | Role |
|--------|------|
| `wildlife/catalog.ts` | Species + loot |
| `wildlife/animalBrain.ts` | Pure AI (unit-tested) |
| `wildlife/WildlifeSystem.ts` | Load, spawn, update, damage, butcher |
| `Studio` | Spawns pack, melee damages animals, KeyN harvest |

## Design notes

- **Additive** — does not replace Targets / DungeonEnemies.
- Combat dummies and wildlife are separate systems.
- Next: bag inventory for drops; aquatic water volumes; sparrow short hop flights.
