# Awakened Caesar Pit Boss Integration

## Overview
Helm lock A integrates the Awakened Caesar (Mst_902_AwakenedCaesar) from the Arena of Valor pack as the dungeon pit boss visual. This replaces the procedural capsule-with-horns "Moloch Da God" mesh while keeping all combat mechanics, stats, and behaviors unchanged.

## Asset Requirements

### GLB Conversion
- **Source**: dark_slayer_caesar_arena_of_valor (Mst_902 rig)
- **Converter**: ObjectStore agent `bc-d11136d8` (GLB only, not the 104MB app.json)
- **Target Path**: `public/models/enemies/dark_slayer_caesar_arena_of_valor.glb`
- **Fallback CDN**: `https://assets.grudge-studio.com/models/enemies/dark_slayer_caesar_arena_of_valor.glb`

### Conversion Spec
- **Tool**: ObjectStore `tools/grudge-convert` agent (NOT Dungeon.ts maxDim>300 auto-scale)
- **Scale**: Meters (SI-fit to 1.8m human yardstick, NOT 2m capsule)
- **Orientation**: Y-up, -Z forward
- **Format**: Quaternions, hip bind
- **Rig Notes**: 
  - Bip001 root + wings/tail/EF_ball
  - **NO thigh/calf/foot bones** → skip leg IK
  - Ground via capsule origin, not foot placement

### Animation Mapping
Caesar clips map to existing DungeonEnemies combat slots:

| Caesar Clip | Combat Slot | Usage |
|-------------|-------------|-------|
| Idle | `idle` | Locomotion visual (loop) |
| Run | `run` | Locomotion visual (loop) |
| Atk1 | `attack` | CombatController light attack |
| Atk2 | `attack` | CombatController heavy attack (same slot) |
| Spell1 | `skill` | DungeonEnemies telegraph/projectile skill |
| Spell2 | `skill` | DungeonEnemies telegraph/projectile skill |
| Spell4 | `skill` | DungeonEnemies telegraph/projectile skill |
| Born2 | `spawn` | Plays once on spawnPit, then transitions to idle |
| Dead | `dead` | On kill |

**Scene clip**: Ignored (editor metadata, not animation)
**Tornado**: VFX only, not a gameplay hazard

## VFX Notes
- **Tornado**: VFX only, NOT a hazard volume
- **No DoT stacks**: CombatController has no burn/passive effects
- **Fire during skills**: Visual only, existing DungeonEnemies projectile/telegraph system

## Combat Unchanged
- **Stats**: Moloch Da God profile (1600 HP, 52 ATK, 22 DEF, 3.6 scale)
- **Behavior**: Pit spawn (hardened, noRespawn), KCC via Controller.setCollision
- **Navmesh**: pitNav (flat sealed floor, not lava editor arena)
- **Targeting**: Player and allies unchanged (KCC + CombatTargets)

## Implementation Status
- ✅ Added "boss" to `GLB_ENEMY_KINDS`
- ✅ Added Caesar GLB spec (path, 1.8m SI-fit height)
- ✅ Extended `classifyHeroClip()` for Atk*/Spell*/Born2 mapping
- ✅ Born2 spawn animation plays once on spawnPit, transitions to idle
- ✅ Documented leg-less rig grounding (capsule origin, no foot IK)
- ✅ Documented ObjectStore conversion: tools/grudge-convert (Y-up, -Z, metres, quats, hip bind)
- ⏳ **Pending**: Caesar GLB asset at specified path (ObjectStore conversion in progress)

## Testing Checklist
- [ ] Pit boss stands at SI-fit scale (~1.8m human reference, not 2m capsule)
- [ ] Atk1/Atk2 fire during CombatController attack windows
- [ ] Spell1/Spell2/Spell4 fire during DungeonEnemies skill telegraphs
- [ ] Dead animation plays on kill
- [ ] Procedural capsule fallback if GLB load fails
- [ ] Hardened pit combat (max difficulty regardless of setting)
- [ ] NoRespawn behavior (boss stays dead after clear)

## Non-Goals (Explicitly Out of Scope)
- ❌ Puter editor scripts (app.json is ART ONLY)
- ❌ Lava arena physics (Synty dungeon trimesh remains SSOT)
- ❌ Tornado as gameplay hazard (VFX only)
- ❌ DoT/burn stacks (CombatController has none)
- ❌ New ally AI or player changes
- ❌ Dungeon.ts maxDim>300 auto-scale for Caesar kit
