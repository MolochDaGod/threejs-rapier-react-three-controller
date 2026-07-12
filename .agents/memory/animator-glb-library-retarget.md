---
name: Animator unified GLB library retargeting
description: How real GLB fighters play the shared mixamorig FBX weapon library on their own mesh via SkeletonUtils.retargetClip.
---

# Unified animation retargeting pipeline (GLB chars play the shared library)

Real GLB fighters (Racalvin first) play the full shared `mixamorig*` FBX
weapon-class library on their OWN mesh. Pure name logic in `retargetMap.ts`,
runtime in `retargetLibrary.ts`, wired in `EditorScene.retargetSharedLibrary`.

**The retargetClip SOURCE must be a real SkinnedMesh.** `SkeletonUtils.retargetClip`
needs a source that (a) the FBX library clip can bind to BY BONE NAME (so
`mixamorigHips.quaternion` tracks resolve) AND (b) carries `.skeleton.bones`.
`makeRetargetSource` reuses an existing SkinnedMesh in the loaded skeleton-source
scene, else synthesizes one wrapping the bone hierarchy.

**Output tracks are `.bones[Name].quaternion`** — those only bind against a root
with a `.skeleton`. The editor/Character play GLB clips on the scene GROUP's mixer
by NODE name, so we rename `.bones[X].quaternion` → `X.quaternion` and keep
rotation only (engine owns root translation). Same convention as the box-rig
retarget.

**`preserveBonePositions` is NOT a valid `RetargetClipOptions` key in three r0.184**
(it's `preserveHipPosition`). Don't pass it — the default already emits
quaternion-only for non-hip bones, which is exactly rotation-only retarget.

**Bone-name map auto-derives** from the target rig's actual bone names via
`canonicalSuffix` (folds Spine01→Spine1, lowercase neck→Neck, strips mixamorig
prefix, drops leaf bones like head_end/finger tips). Racalvin's 24 joints map with
zero misses. Quirky rigs can override per-bone via `CharacterDef.retargetAliases`.

**Why the async cleanup matters:** in `loadCatalogCharacter` the GLB root is added
to the scene AND registered BEFORE the `await retargetSharedLibrary`. If the load
is cancelled (rigToken changed / disposed) during that await, you must
`root.parent?.remove(root)` + `unregisterSubtree(rootId)` + `disposeObject3D` —
disposing GPU resources alone leaves a zombie node in editor state. (The earlier
guard after `loadAsync` only disposes because nothing was registered yet.)

**How to apply:** verify CPU-only retarget with typecheck + the pure
`retargetMap.test.ts` (no WebGL). The GLB's OWN baked clips still ship raw
mixamorig/Sword tracks and will warn "No target node found" — that's pre-existing
to those baked clips, not the retargeted library (which binds clean).
