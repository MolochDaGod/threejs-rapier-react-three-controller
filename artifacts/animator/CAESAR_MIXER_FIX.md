# Caesar Pit Boss Mixer Fix

## Problem Statement
The Caesar GLB contained 9 animations, but only 2 were actually playing (Atk1 and Spell1). The other attack and skill animations (Atk2, Spell2, Spell4) were being silently discarded by the mixer setup code.

## Root Cause
The original code stored only ONE AnimationAction per action category:
```typescript
actions: Map<string, THREE.AnimationAction>
```

When processing clips, if a key already existed in the map, the new clip was skipped:
```typescript
if (!key || e.actions.has(key)) continue;  // ← This line discarded Atk2, Spell2, Spell4
```

Since both Atk1 and Atk2 map to the "attack" category, only Atk1 was stored.
Since Spell1, Spell2, and Spell4 all map to the "skill" category, only Spell1 was stored.

## Solution Applied
Changed the actions map to store ARRAYS of actions:
```typescript
actions: Map<string, THREE.AnimationAction[]>
```

Now all animations for each category are stored, and one is randomly selected when playing:
```typescript
const candidates = e.actions.get(role);  // Get array of actions
const next = candidates[Math.floor(Math.random() * candidates.length)];  // Random selection
```

## GLB Animation Details
The Caesar GLB (`public/models/enemies/caesar_pit_boss.glb`) contains these animations:

| Clip Name | Category | Duration | Usage |
|-----------|----------|----------|-------|
| `Armature\|Born2\|Base Layer` | spawn | 2.37s | One-shot on pit spawn |
| `Armature\|Idle\|Base Layer.001` | idle | loop | Standing idle |
| `Armature\|Atk1\|Base Layer.001` | attack | 1.67s | Light attack |
| `Armature\|Atk2\|Base Layer.001` | attack | 2.00s | Heavy attack |
| `Armature\|Run\|Base Layer.001` | run | loop | Movement |
| `Armature\|Spell1\|Base Layer.001` | skill | 2.33s | Skill variant 1 |
| `Armature\|Spell2\|Base Layer.001` | skill | 2.67s | Skill variant 2 |
| `Armature\|Spell4\|Base Layer.001` | skill | 3.00s | Skill variant 3 |
| `Armature\|Dead\|Base Layer.001` | dead | — | Death animation |

## Verification Instructions

### 1. Start the Preview
```bash
cd artifacts/animator
pnpm run dev
```

### 2. Navigate to Pit Boss Fight
Open the preview (usually `http://localhost:3000`) and navigate to the dungeon pit where the boss spawns.

### 3. Open Browser Console
Press F12 to open DevTools, then go to the Console tab.

### 4. Watch for Mixer Logs
When Caesar spawns, you should see:
```
[DungeonEnemies] Awakened Caesar raw gltf.animations: Armature|Born2|Base Layer, Armature|Idle|Base Layer.001, ...
[DungeonEnemies] Awakened Caesar loaded clips=Armature|Born2|Base Layer,...
[DungeonEnemies] boss actions map: spawn:1, idle:1, run:1, attack:2, skill:3, dead:1
```

The key line is `attack:2, skill:3` which confirms 2 attack animations and 3 skill animations are registered.

### 5. Trigger Combat
Engage the Caesar boss and watch for animation playback logs:
```
[DungeonEnemies] boss playing "spawn" → clip "Armature|Born2|Base Layer" (2.37s, 1 variants, selected #0)
[DungeonEnemies] boss playing "idle" → clip "Armature|Idle|Base Layer.001" (3.00s, 1 variants, selected #0)
[DungeonEnemies] boss playing "attack" → clip "Armature|Atk1|Base Layer.001" (1.67s, 2 variants, selected #0)
[DungeonEnemies] boss playing "attack" → clip "Armature|Atk2|Base Layer.001" (2.00s, 2 variants, selected #1)
[DungeonEnemies] boss playing "skill" → clip "Armature|Spell2|Base Layer.001" (2.67s, 3 variants, selected #1)
```

### 6. Verify Animation Variety
Over multiple attacks/skills, you should see:
- Attacks alternate between Atk1 (1.67s) and Atk2 (2.00s)
- Skills vary between Spell1 (2.33s), Spell2 (2.67s), and Spell4 (3.00s)
- The "selected #N" index changes randomly

### 7. Verify Height
Use the browser's element inspector or console to check Caesar's position:
```javascript
// In browser console
scene.getObjectByName('caesar') // or similar query
// Check the bounding box Y-dimension should be ~3.695m
```

## Success Criteria
✅ Caesar loads at native 3.695m height (no scaling artifacts)
✅ Born2 spawn animation plays once (2.37s)
✅ Idle animation loops smoothly
✅ Both Atk1 and Atk2 fire randomly during combat
✅ All three Spell animations (1/2/4) fire randomly every 3rd attack
✅ Dead animation plays on death
✅ Console logs show clip names, durations, and variant selection

## Dungeon Spawn Fix (Required for Verification)

### Problem
Original playtest showed:
- Camera clipped inside dungeon geometry
- Player defeated in ~10 seconds
- Caesar never appeared in frame (50m below at pit floor)
- Animations could not be verified

### Solution
Modified `Dungeon.ts` to spawn player DIRECTLY in the pit arena:
- Player spawns 10m back from pit center (same Y as Caesar)
- Caesar at pit center is immediately visible
- No surface-to-pit descent required
- Clean camera view with no geometry clipping

```typescript
// Player at (pitX, pitY, pitZ - 10) facing Caesar at (pitX, pitY, pitZ)
spawnPlayerInPit() {
  const x = this.pitSpawn.x;
  const y = this.pitSpawn.y + 0.05;
  const z = this.pitSpawn.z - 10;  // 10m back from center
  this.spawn.set(x, y, z);
}
```

## Commits
- `d82c724` - Fix Caesar mixer: store multiple animations per action type
- `eed8030` - Add detailed animation playback logging
- `5a79ce9` - Add comprehensive mixer fix documentation
- `9631f52` - Remove temporary animation check script
- `1cadd30` - Fix dungeon spawn: place player in pit arena with Caesar

## Files Changed
- `artifacts/animator/src/three/dungeon/DungeonEnemies.ts` - Mixer fix and logging
- `artifacts/animator/src/three/dungeon/Dungeon.ts` - Spawn placement fix
- `artifacts/animator/CAESAR_MIXER_FIX.md` - Documentation
