# Awakened Caesar Pit Boss Integration

## Overview
Helm lock A wires the clip map for the Awakened Caesar (Mst_902_AwakenedCaesar) pit boss GLB while keeping the existing procedural capsule-with-horns until the converted GLB is placed. All combat mechanics, stats, and behaviors remain unchanged.

## Asset Requirements

### GLB Conversion
- **Source**: dark_slayer_caesar_arena_of_valor (Mst_902 rig)
- **Converter**: ObjectStore `tools/grudge-convert` (GLB only, not the 104MB app.json)
- **Target Path**: TBD (pending ObjectStore conversion completion)
- **Do NOT invent**: URL, R2 key, or placeholder mesh

### Conversion Spec
- **Tool**: ObjectStore `tools/grudge-convert`
- **Format**: Native metres, Y-up, -Z forward, quaternions, hip bind
- **NO height normalization**: Load at native metres (FORBID SI-fit, FORBID maxDim>300 auto-scale)
- **Rig Notes**: 
  - Bip001 root + wings/tail/EF_ball
  - **NO thigh/calf/foot bones** → skip leg IK
  - Ground via existing pit-boss capsule origin (not foot placement)

### Animation Mapping (READY, clips wired)
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

## Current State
- ✅ **Clip map wired**: Atk*/Spell*/Born2 mapping ready in `classifyHeroClip()`
- ✅ **Born2 spawn**: Plays once on spawnPit, transitions to idle
- ✅ **Native metres**: No SI-fit, no maxDim>300 auto-scale (height: 0 = native)
- ✅ **Rig documented**: Bip001, no thigh/calf/foot, capsule-grounded
- ⏸️ **Boss stays capsule**: Existing Moloch procedural mesh until GLB placed
- ⏳ **Pending**: Caesar GLB from ObjectStore tools/grudge-convert

### To Enable Caesar Visual (when GLB ready):
1. Place converted GLB at determined path
2. Uncomment `CAESAR_MODEL` constant (line ~73)
3. Uncomment `"boss"` in `GLB_ENEMY_KINDS` (line ~82)
4. Uncomment boss case in `glbSpec()` (line ~468-469)
5. Verify: pit boss stands at native scale, Atk/Spell fire

## Testing (when GLB placed)
- [ ] Pit boss loads at native metres (no SI-fit, no maxDim scaling)
- [ ] Born2 spawn animation plays once, transitions to idle
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
