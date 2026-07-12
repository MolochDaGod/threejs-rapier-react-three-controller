---
name: Animator FBX skeleton normalization
description: Why non-mixamorig FBX anim packs silently fail to bind to the Explorer box rig, and the auto-normalization that fixes them.
---

The Explorer box rig (`VoxelCharacter`) builds bones named `mixamorig*` from the
skeleton source (`bow/unarmed-idle-01`, a `mixamorig:*` clip). THREE's
`AnimationMixer` binds tracks by EXACT name, so a clip only animates the rig when
its tracks are named `mixamorig<Bone>`.

**Trap:** some FBX packs are authored on a foreign "Retargeted Clip" skeleton with
NO `mixamorig` prefix and different spine/head naming — two observed variants:
`Hips/Spine11/Spine21/Head1/Neck` and `Hips/Spine01/Spine02/Head/neck` (+ extra
`Armature/headfront/*_End` containers). The ENTIRE great-sword family is like this.
Such clips bind to nothing and SILENTLY never animate (`loadClips` swallows errors,
the Animator falls back). This is what left every two-handed melee class
(greatsword/greataxe/spear/hammer2h — all share `TWO_HAND_MELEE_LOCO` = great-sword
clips) with dead idles + locomotion, while one-hand classes (sword pack = native
`mixamorig`) worked fine.

**Fix / rule:** `loadClips` auto-detects any FBX clip with zero `mixamorig` tracks
and routes it through `normalizeRetargetedFbxClip` — renames bones to `mixamorig*`,
keeps all rotations + ONLY the root (Hips) position (paired with
`lockHorizontalRoot`), drops limb positions (foreign proportions dislocate). Native
mixamorig clips and the GLB combo path (`retargetMixamoClip`) are untouched.

**Why root-pos kept (not pure rotation like the GLB retarget):** loco needs vertical
bob; `lockHorizontalRoot` runs on every cached action and re-baselines hip Y to the
rig bind height + locks X/Z, so foreign root height/drift is corrected safely.

**How to apply:** when adding any new FBX anim pack under `public/anim`, you don't
need to pre-convert its skeleton — normalization is automatic. But if a clip looks
dead, check its bone naming first; if `canonicalRigBone` doesn't cover a new variant,
extend it (and there's a unit test `normalizeRetargetedFbxClip.test.ts` to keep the
mapping honest). Verify track-name binding offline by parsing the FBX with three in
Node (FBXLoader.parse on the file buffer).

**Two MORE silent-failure modes beyond bone naming (a binding audit must check all):**
1. **Empty clip that still registers** — an FBX with 0 tracks (e.g. a corrupt
   `reactions/knocked-out`) loads "successfully" and registers as a valid action, so
   the engine's missing-clip fallback (e.g. KO→fallDown) NEVER fires and the verb
   silently no-ops. An empty clip is worse than a missing one.
2. **FBXLoader binary-parse failure** — some FBX throw `Unknown property type` inside
   FBXLoader's parser. This is DETERMINISTIC and env-independent (fails identically in
   Node and the browser — it's the same loader), so `loadClips`' try/catch swallows it
   and the clip just never exists. (Contrast: a *texture/material* hang only happens in
   Node's headless parse and is a false positive for binding.)

**No FBX→GLB tooling in the sandbox** (no blender/FBX2glTF), so the only fix for an
empty or parser-failing FBX is to repoint the catalog verb to a working sibling clip
that binds (verify the substitute parses + binds first).

**Offline audit:** `artifacts/animator/audit-skeleton-binding.mjs` parses the real
skeleton-source FBX for the 25 rig bones, then for every catalog-referenced clip
replicates loader.ts's native-vs-normalize/retarget logic and flags DEAD (0 rig
bones) / PARTIAL (missing Hips/arms) / empty / parse-fail. Keep it as a regression
guard; rerun after any clip-catalog or anim-library change. The lone expected
"problem" is the GLB combo (`combo/melee-combo-1`) timing out on a Node texture
hang — its rotation-only retarget is known-good.
