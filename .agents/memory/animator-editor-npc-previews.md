---
name: Voxel Editor NPC previews
description: How the animator Voxel Editor renders NPC presets and why it uses the same procedural Explorer rig as the in-game fighters
---

# Voxel Editor NPC previews (animator artifact)

Editor NPC deployables render as procedural **ExplorerCharacter** rigs — the same
rig the in-game/duel fighters use (`Targets.ts` spawns `new ExplorerCharacter`),
so what you place in the editor matches what you fight. The old static-GLB
approach (a shared idle-posed "orc" template cloned via `SkeletonUtils` with
`mountWeaponModel` hand mounts) was removed: that GLB couldn't hold weapons or
play clips. Imports are relative (the artifact forbids `@workspace/*`).

**Per-NPC build** (`upgradeNpcModel`):
- Tint via a stable colourway: `def = {...getCharacter("explorer"), look: npcLook(id)}`
  where `npcLook` is a hash over the NPC id into a fixed `NPC_LOOKS` palette
  (distinct shirt/pants), so a placed NPC keeps its colour across edits/reloads.
- Store `group.userData.avatar` **immediately** (before the async `load()`) so a
  mid-load removal/teardown can dispose the half-built rig.
- `setWeaponId` before `load()`, then `equipProceduralWeapon` after — mirrors
  `Targets.attachAvatar`. `ExplorerCharacter.update(dt)` no-ops until loaded, so
  it's safe to drive every frame from the editor loop right away.
- Cancel guard after `await load()`: bail + `avatar.dispose()` if `disposed`, the
  deployable's group was removed/replaced, or `userData.avatar` was swapped.

**Weapon mapping:** preview the *melee* weapon the NPC actually fights with.
`npcPreviewWeapon` maps `none|bow|pistol|rifle → "sword"` (mirrors
`VoxelArena.npcWeapon`). NPC combat is melee-only, so the rig holds a sword even
when the authored/label weapon is ranged — this mismatch is intentional (held
weapon = combat reality, label = authored config).

**Disposal:** `freeDeployable` removes `avatar.root` from its parent and calls
`avatar.dispose()` (per-instance materials are the rig's own). Editor `dispose()`
just runs `freeDeployable` over all deployables + disposes the label-texture
cache — there is no longer any shared template geo/mats to free.

Labels are still `THREE.Sprite`s with a cached `CanvasTexture` (keyed by
text+accent), `depthTest:false` + high `renderOrder` so they float above the NPC.
