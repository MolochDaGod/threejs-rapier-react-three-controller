# Caesar GLB Asset Placement

## File Ready
The converted Caesar pit boss GLB is ready at **4,313,096 bytes** (4.3 MB).

## Source Location (Grok Box)
```
/workspace/public/models/enemies/caesar_pit_boss.glb
/workspace/caesar-extract/caesar_pit_boss.glb
```

## Target Location (THIS Repo)
Copy the file to:
```
artifacts/animator/public/models/enemies/caesar_pit_boss.glb
```

This resolves to the runtime path:
```
models/enemies/caesar_pit_boss.glb
```

## Verified Specifications
- **File size**: 4,313,096 bytes
- **World bbox**: 
  - min: [-1.142, 0.000, -1.381]
  - max: [1.142, 3.695, 1.475]
  - size: [2.285, 3.695, 2.856] metres
- **Max dimension**: 3.695m (Y-axis, native height)
- **Y-hip on ground**: Model already grounded at Y=0
- **Scale**: _rootJoint [37.18, 46.97, 46.97] baked into world size
- **Wrapper**: Identity transform
- **Format**: Native metres, Y-up, -Z forward
- **Clips**: Born2, Idle, Atk1, Atk2, Run, Spell1, Spell2, Spell4, Dead
- **Scene clip**: Absent (as expected)

## Loading Behavior
- **NO height normalization**: `height: 0` loads at native 3.695m
- **NO SI-fit**: Preserves ObjectStore tools/grudge-convert output
- **NO maxDim>300 auto-scale**: Loads verbatim
- **Ground on capsule**: Existing pit boss capsule collision
- **Skip leg IK**: Mst_902 has no thigh/calf/foot bones

## Code Status
✅ Code updated to load `models/enemies/caesar_pit_boss.glb`
✅ `"boss"` added to `GLB_ENEMY_KINDS`
✅ glbSpec returns `height: 0` for native loading
⏳ Awaiting file copy to target location

## After File Placement
Once `caesar_pit_boss.glb` is in place:
1. Pit boss spawns with Caesar mesh (3.695m native height)
2. Born2 spawn animation plays once
3. Atk1/Atk2 fire during combat (CombatController)
4. Spell1/2/4 fire during skills (telegraph/projectile)
5. Dead animation on kill
6. Graceful capsule fallback if load fails
