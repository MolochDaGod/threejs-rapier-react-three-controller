---
name: Identity-rest FBX packs need offline bake
description: Gesture-style FBX packs authored on an identity-rest skeleton cannot be runtime-normalized; bake offline with rest-pose localOffsets and ship native GLB clips.
---

Some marketplace FBX packs (e.g. the idle-break gesture pack) are authored on an
**identity-rest skeleton**: every bone's rest rotation is (0,0,0) and limb
direction lives entirely in bone translations, with unprefixed names like
`Hips`/`Spine11`. The rig and all mixamo packs carry real rest rotations.

**Why:** the rename-only runtime normalizer (`normalizeRetargetedFbxClip`)
binds those near-identity rotations wrong — legs fold to the head, body pitches
through the floor. And `SkeletonUtils.retargetClip` (three r0.184) copies source
bone WORLD rotation onto the target with NO rest-pose compensation, so a naive
retarget is just as broken.

**How to apply:** bake offline (`scripts/src/retarget-gestures.mjs`, npm script
`retarget-gestures`): pass `localOffsets[targetBone] = inv(srcRestWorld) *
tgtRestWorld` to `retargetClip` (rest maps to rest, deltas carry across bone
axes), export rotation-only node-name-addressed GLB, pose-check head/hips/feet
heights, then add the clip ids to `NATIVE_GLB_CLIP_IDS` so the broken FBX is
never fetched. Rotation-only output (no hips.position) is safe: root helpers
no-op when the track is absent.

Detection: dump a pack's bone rest rotations in Node — all-zero rest rotations
= identity-rest pack = offline bake required.
