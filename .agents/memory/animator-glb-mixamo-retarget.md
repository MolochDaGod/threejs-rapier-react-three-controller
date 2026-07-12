---
name: Animator GLB Mixamo retarget
description: How to add Mixamo GLB animation clips to the Explorer rig in an otherwise-FBX library, and why retarget is rotation-only.
---

# Adding Mixamo GLB clips to the Explorer rig

The animator clip library is FBX-by-convention (`public/anim/animations/<class>/<clip>.fbx`,
resolved by catalog id). Some donated clips only exist as GLB. To mix them in:

- Register the id in a `GLB_CLIP_IDS` set (clipCatalog). The loader routes ids in
  that set through `GLTFLoader`; everything else loads as FBX. The id still maps
  1:1 to a file under `public/anim/...` (just `.glb` instead of `.fbx`).
- The clip is stored in the same `id -> AnimationClip` map; nothing downstream
  cares whether it came from FBX or GLB.

## Retarget is ROTATION-ONLY — this is the load-bearing decision

When importing a Mixamo GLB clip authored on a DIFFERENT character than our
skeleton source, **keep only `.quaternion` tracks and drop all position tracks.**

**Why:** Mixamo retargets each download to that character's bone *proportions*, so
the GLB's per-bone position (translation) values are bind-pose offsets for a rig
with different bone lengths than ours. Applying them dislocates limbs. Joint
*rotations* transfer cleanly across any same-topology skeleton, and the engine
already owns root displacement, so dropping positions (incl. Hips) just makes the
clip play in-place — correct for attacks.

**How to apply:** also normalize each track's target node name to our rig's
`mixamorig*` convention: strip the `mixamorig:` colon (GLTFLoader may already have
sanitized it away) and drop the trailing `_<digits>` suffix Mixamo/Sketchfab
exports append per bone (`mixamorig:Head_00` → `mixamorigHead`). Tracks for bones
not in the 25-bone rig (fingers, end-effectors) simply no-op.

## FBX clips KEEP position tracks → re-baseline hip-Y or the rig floats

The rotation-only drop above is the GLB path only. **FBX clips keep their full
track set, including `mixamorigHips.position`.** `lockHorizontalRoot` locks X/Z to
the first frame but the vertical channel is re-baselined to the rig's **bind-pose
Hips Y** (captured once at `Animator` construction), keeping only the relative bob.

**Why:** a pack exported with a different absolute hip height than the rig's bind
pose drives the hips to that height every frame, floating (or sinking) the whole
body a fixed amount — this is exactly what made the dedicated pistol pack float
the Gunslinger ~a foot off the ground. Re-baselining is a no-op for packs already
authored at the rig height (first-frame Y ≈ bindHipY), so it won't disturb the
other weapon packs. Feet-on-ground for a procedural rig is otherwise NOT verifiable
in the sandbox (no WebGL).

## retargetMixamoClip MUST be non-mutating

The same retarget helper now also powers the Dressing Room's auto-wire of
*imported* Mixamo clips onto the loaded procedural rig. Those clip objects are
**still bound to the imported model's own AnimationMixer** for the
imported-clip-on-model preview path, so the retarget must clone each track
before renaming it — never write `track.name` in place, or the model preview
gets corrupted track targets.

**Why:** an in-place rename mutates the shared clip the model mixer plays,
silently breaking the original imported-model playback.

**How to apply:** `track.clone()` then set `.name` on the clone; the procedural
rig plays the retargeted clips through its own `Animator` (looped external clip),
NOT a second mixer bound to the rig root.

## Registration lockstep still applies

A GLB combo is just a clip id, so the usual procedural-clip lockstep holds
(ActionKey → catalog entry → Animator play path → ExplorerCharacter verb/VERBS).
Combos that should work regardless of loadout go in `GLOBAL_ACTIONS` and are
played via `playAction` (which falls back to `resolveGlobalAction`). Note
`createAnimatedCharacter({ classes })` does NOT preload `GLOBAL_ACTIONS` — only the
default (no-`classes`) Explorer load does — so class-scoped hosts won't get them.
