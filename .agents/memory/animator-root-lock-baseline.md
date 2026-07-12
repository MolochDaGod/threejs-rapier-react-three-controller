---
name: Animator root-lock baseline (lockHorizontalRoot)
description: Why the explorer rig's horizontal root-lock must re-baseline hip X/Z to bind pose, not the clip's first frame, and match the hips track tolerantly.
---

# lockHorizontalRoot must center to BIND pose, not frame-0

`lockHorizontalRoot` (Animator.ts) neutralises a clip's horizontal root motion so
the engine/Dressing-Room owns world translation. It must:

1. **Re-baseline hip X/Z to the rig's bind-pose hip position** (captured as
   `bindHipX/bindHipZ` from `skeletonRoot` `mixamorigHips`), NOT to the clip's
   first frame.
2. **Match the hips track tolerantly** via `isHipsPositionTrack` — strip
   `^mixamorig:?` then test `/^Hips\d*$/` — covering `mixamorigHips.position`,
   bare `Hips.position`, and `mixamorig:Hips.position`.

**Why:** Many FBX "Retargeted Clip" packs (the `block/`, `extra/`, `reactions/`
families) author the Hips translation track tens of units OFF-ORIGIN (e.g.
`extra/backwards-jump` starts at Z≈60.8 with ~41 of Z travel) AND some keep a
bare `Hips.position` name. The old code pinned X/Z to frame-0 (so those packs
planted the rig ~55–60 units off-center — the "feet meters away" bug) and matched
only the exact string `mixamorigHips.position` (so un-normalised `Hips.position`
packs escaped the lock entirely). Native Mixamo in-place clips sit at ≈origin,
which is why a plain sword block previewed fine while everything else drifted.

**How to apply:** Whenever touching root-lock / in-place behavior, keep both
properties. Re-baselining to bind is a no-op for native clips (frame-0 ≈ bind)
and improves retargeted packs everywhere it's shared (Dressing Room + Danger
Room/Studio combat). To inspect a clip's authored root offset offline, parse the
FBX in Node with the `convert-character.mjs` DOM shims + `three`'s `FBXLoader`
(run from inside `artifacts/animator` so `three` resolves) and dump the
`*.position` track XZ range — see `animator-fbx-node-conversion.md`.
