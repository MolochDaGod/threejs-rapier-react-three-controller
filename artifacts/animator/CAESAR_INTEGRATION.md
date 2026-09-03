# Awakened Caesar Pit Boss Integration

## Overview
Helm lock A wires the clip map for the Awakened Caesar (Mst_902_AwakenedCaesar) pit boss GLB while keeping the existing procedural capsule-with-horns until the converted GLB is placed. All combat mechanics, stats, and behaviors remain unchanged.

## Caesar GLB Ready ✅

### Binary Confirmed
- **Location**: `public/models/enemies/caesar_pit_boss.glb` ✅
- **Size**: 4,313,096 bytes (4.2 MB) ✅
- **SHA256 prefix**: `7ef1a6e3329195d6` ✅
- **Commit**: `18a5f12ffe03f50899db049e313341059c45e76b` ✅
- **Source**: `/workspace/public/models/enemies/caesar_pit_boss.glb` (Grok box)

### Code Configuration ✅
- **CAESAR_MODEL**: `"models/enemies/caesar_pit_boss.glb"` (line 77)
- **GLB_ENEMY_KINDS**: `"boss"` added (line 89)
- **glbSpec**: Returns `height: 0` for boss (line 485-486)
- **Loading**: Native 3.695m, NO height scaling when `height: 0` (line 510-512)

### Verified Dimensions
- **Bounding box**: 
  - min: [-1.142, 0.000, -1.381]
  - max: [1.142, 3.695, 1.475]
  - size: [2.285m, 3.695m, 2.856m]
- **Max dimension**: 3.695m (Y-axis, native height)
- **Y-hip on ground**: Already grounded at Y=0
- **_rootJoint scale**: [37.18, 46.97, 46.97] baked into world size (no compensation)
- **Wrapper**: Identity transform

### Clips Confirmed
✅ Born2, Idle, Atk1, Atk2, Run, Spell1, Spell2, Spell4, Dead
✅ Scene clip absent (as expected)

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

## Current State ✅ READY
- ✅ **Caesar GLB landed**: `public/models/enemies/caesar_pit_boss.glb` (4.3 MB, commit 18a5f12) ✅
- ✅ **Code ready**: Caesar GLB loading enabled at native 3.695m
- ✅ **Clip map wired**: Atk*/Spell*/Born2 confirmed in file, mapped in code
- ✅ **Born2 spawn**: Plays once on spawnPit, transitions to idle
- ✅ **Native metres**: height: 0 loads at 3.695m (no SI-fit, no maxDim scaling)
- ✅ **"boss" in GLB_ENEMY_KINDS**: Pit boss will load Caesar mesh
- ✅ **glbSpec updated**: `caesar_pit_boss.glb` at height: 0
- ⏳ **Awaiting user testing**: All code complete, ready for dungeon spawn verification

### Expected Behavior
Once testing starts, pit boss will:
1. Load Caesar mesh at native 3.695m height
2. Play Born2 spawn animation once
3. Fire Atk1/Atk2 during CombatController attacks
4. Fire Spell1/2/4 during DungeonEnemies skills
5. Play Dead animation on kill
6. Fall back to procedural capsule if load fails

## Testing Checklist (For User Verification)
When testing the dungeon pit boss spawn:
- [ ] Pit boss loads with Caesar mesh at native ~3.7m height (no SI-fit, no maxDim scaling)
- [ ] Born2 spawn animation plays once on pit spawn, transitions to idle
- [ ] Atk1/Atk2 fire during CombatController attack windows (light/heavy)
- [ ] Spell1/Spell2/Spell4 fire during DungeonEnemies skill telegraphs/projectiles
- [ ] Dead animation plays on kill
- [ ] Procedural capsule fallback if GLB load fails (graceful degradation)
- [ ] Hardened pit combat (max difficulty regardless of setting)
- [ ] NoRespawn behavior (boss stays dead after clear)

## Non-Goals (Explicitly Out of Scope)
- ❌ Puter editor scripts (app.json is ART ONLY)
- ❌ Lava arena physics (Synty dungeon trimesh remains SSOT)
- ❌ Tornado as gameplay hazard (VFX only)
- ❌ DoT/burn stacks (CombatController has none)
- ❌ New ally AI or player changes
- ❌ Dungeon.ts maxDim>300 auto-scale for Caesar kit
