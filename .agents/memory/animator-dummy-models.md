---
name: Animator Danger Room dummy models
description: How the passive training-dummy GLB visuals replace the primitive target capsules, and the dispose-once cloning rule.
---

# Danger Room passive dummy models

The Danger Room's inert "training dummies" are real GLB models, not the old
primitive capsules. Source loader: `src/three/DummyModels.ts`.

> Note: the room now **boots NEUTRAL** — only the player + the resident DJ
> (Racalvin booth/lights) spawn on entry. There is NO default hostile/dummy
> roster in the `Studio` constructor anymore; dummies/enemies are spawned only
> on demand (Admin panel `spawnNpc`/`spawnBoss`, or `startDuel`). The cloning /
> disposal / hit-volume rules below still apply whenever they ARE spawned.

- **Convert first, runtime stays dumb.** Each dummy GLB is run through
  `scripts/convert-character` offline → `public/models/<id>.glb`, normalized to
  2m tall, feet at Y=0, centered XZ, clips preserved. Runtime only clones +
  scales + plays the embedded clip; it does NOT retarget (these rigs have no
  mixamorig bones, so the shared FBX library can't drive them — they play their
  OWN clips).
- **Dispose-once cloning.** Instances are `SkeletonUtils.clone` of one template
  per kind; the clone SHARES the template's geometry + materials. So an
  instance's `dispose()` must only stop its mixer + detach its root — it must
  NEVER free geo/mats. The shared geo/mats are freed exactly once in
  `DummyModels.dispose()` (called from `Targets.dispose()` after per-dummy
  cleanup). Same rule as PunchingBags / faction rings.
- **Passivity is a clip-policy decision.** training loops `Idle`; ogre/bear loop
  their sole creature `Action` (reads as breathing idle). dummyFight (a
  humanoid+sandbag whose only clip is a PUNCH) and animatedTraining (only
  `Damaged_*` clips) are frozen on frame 0 so a passive dummy never animates an
  attack; animatedTraining additionally plays `Damaged` on hit via `react()`.
- **Hit volume is untouched.** Dummies are hit through `Targets.chest()` — pure
  position math (group.position + y offset, CHEST_RADIUS), so hiding the
  primitive body/head/accent meshes never affects hit registration. The base
  disc is KEPT as a small stand under the model.
- **Async mount guard.** `attachDummyModel` latches `d.modelKind`; the load
  continuation bails if the kind changed or the dummy was cleared — mirrors
  `attachAvatar`. `DummyModels.load` clears its `pending` slot in a `finally` so
  a rejected load can be retried (not wedged forever).

**Why bags weren't touched:** the punching-bag bodies are high-hanging pendulums
(COM well above ground); a ground-standing humanoid mounted on that body floats.
The genuine "black target shapes" were the ground-standing seeded dummies, which
is what got replaced.
