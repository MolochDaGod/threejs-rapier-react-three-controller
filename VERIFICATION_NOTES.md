# Caesar Pit Boss Verification Guide

## Current PR Status
Branch: `cursor/helm-lock-a-caesar-pit-boss-cdf0`
PR: #1 - https://github.com/MolochDaGod/threejs-rapier-react-three-controller/pull/1

## What Was Fixed

### 1. Mixer Fix (Commits d82c724, eed8030)
**Problem**: Only Atk1 and Spell1 were playable. Atk2, Spell2, Spell4 were silently discarded.

**Solution**: Changed actions map to store arrays of animations, randomly selecting one when playing.

**Result**: All 9 Caesar animations now registered:
- spawn:1 (Born2, 2.37s)
- idle:1 (Idle loop)
- run:1 (Run loop)
- attack:2 (Atk1 1.67s, Atk2 2.00s)
- skill:3 (Spell1 2.33s, Spell2 2.67s, Spell4 3.00s)
- dead:1 (Dead)

### 2. Spawn Fix (Commit 1cadd30)
**Problem**: Player spawned on surface 50m above Caesar, camera clipped in walls, player died before reaching pit.

**Solution**: Player now spawns directly in pit arena, 10m back from Caesar.

**Result**: Caesar immediately visible at native 3.695m height, no camera clipping, clean arena view.

## How to Verify (Next Playtest)

### 1. Enter Dungeon
- Open preview: https://threejs-rapier-react-three-controller-an-git-dcccc4-grudgenexus.vercel.app
- Hit E at portal to enter
- **Expected**: Player spawns in sealed pit arena with Caesar visible ahead

### 2. Open Browser Console (F12)
Watch for these logs on spawn:

```
[DungeonEnemies] Awakened Caesar raw gltf.animations: Armature|Born2|Base Layer, Armature|Idle|Base Layer.001, ...
[DungeonEnemies] boss actions map: spawn:1, idle:1, run:1, attack:2, skill:3, dead:1
[DungeonEnemies] boss playing "spawn" → clip "Armature|Born2|Base Layer" (2.37s, 1 variants, selected #0)
```

Key indicator: `attack:2, skill:3` confirms 2 attacks + 3 skills registered.

### 3. Observe Animations
**Caesar should be visible standing at pit center (~10m ahead).**

Watch for:
- ✅ **Spawn (Born2)**: 2.37s animation plays once, transitions to idle
- ✅ **Idle**: Looping idle stance
- ✅ **Attack**: During combat, randomly plays Atk1 (1.67s) or Atk2 (2.00s)
  - Console: `[DungeonEnemies] boss playing "attack" → clip "Armature|Atk1|Base Layer.001" (1.67s, 2 variants, selected #0)`
  - Console: `[DungeonEnemies] boss playing "attack" → clip "Armature|Atk2|Base Layer.001" (2.00s, 2 variants, selected #1)`
- ✅ **Skill** (every 3rd attack): Randomly plays Spell1/2/4 (2.33-3.00s)
  - Console: `[DungeonEnemies] boss playing "skill" → clip "Armature|Spell2|Base Layer.001" (2.67s, 3 variants, selected #1)`

### 4. Verify Height
Caesar should be ~3.7m tall (roughly 2x player height). No squashing or stretching.

### 5. Document Results
Note in PR:
- Which attack clips played (Atk1 and/or Atk2 with durations)
- Which skill clips played (Spell1/2/4 with durations)
- Caesar height appears correct (~3.7m)
- Camera/spawn placement works (boss visible, no clipping)

## Success Criteria
✅ Player spawns in pit arena with Caesar visible
✅ Born2 spawn animation plays (2.37s)
✅ At least one attack animation verified (Atk1 or Atk2)
✅ At least one skill animation verified (Spell1/2/4)
✅ Console logs show `attack:2, skill:3`
✅ Caesar height ~3.7m (native scale)
✅ No camera clipping

## If Mixer Cannot Be Verified
If animations still don't play or Caesar is not visible, document:
- What you see in the console logs
- Whether Caesar appears at all
- What the camera shows on spawn
- Any error messages

**Do not claim mixer success without visual confirmation of at least one attack + one skill clip playing.**
