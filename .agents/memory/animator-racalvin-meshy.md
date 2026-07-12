---
name: Racalvin pirate = Meshy single-GLB conversion
description: How the "Racalvin the Pirate King" character is built from a Meshy per-clip export, and the converter pipeline for merging skin+clips into one GLB.
---

# Racalvin / Meshy "King of Pirates" body

**Racalvin the Pirate King is `id: "gunslinger"`** in `CHARACTERS` (assets.ts) — a
search for "racalvin"/"pirate" finds nothing; the id is the legacy "gunslinger".
He used to be a `procedural: true` Explorer box rig with a hardcoded pistol-kiter
combat kit; he is now a real GLB body (`models/racalvin.glb`) and the intended
**exemplar for a trainable special-weapon system** (user vision: each weapon
trainable, attacks create space `-MM`, T-pose + weapon import/convert + gizmo, and
Dressing-Room saves as the persisted app source of truth).

**Why the kiter kit was dropped:** all pistol-kiter branches in Studio key on
`def.kiter && weaponId === "pistol"`, so deleting the `kiter` block cleanly
disables that combat without crashes — it falls back to the generic GLB attack/skill
path. Special-weapon combat is meant to be rebuilt on the trainable system, not the
old hardcoded kit.

## Meshy per-clip export gotchas

**Meshy "biped" animation packs ship ONE GLB per clip, each redundantly bundling
the FULL skinned mesh + texture (~9MB each).** Shipping them whole = ~180MB. They
all share an **identical skeleton** (24-joint plain names: `Hips/Spine/Spine01/
Spine02/neck/Head/LeftShoulder…RightHand/LeftUpLeg…RightToeBase`, NOT mixamorig).

**Because the body and every anim GLB share the exact same skeleton, the clips bind
directly with NO retargeting** — unlike the FBX library (`public/anim/`) which needs
mixamorig normalization. So the fix is: keep the body's skin once, copy only the
animation tracks from each anim file into the body doc (target nodes matched by
name), rename to clean role names, write a single self-contained GLB — same pattern
as `sanji.glb`.

## Converter

`scripts/src/merge-glb-anims.mjs` (uses `@gltf-transform/core`, installed in
`@workspace/scripts`): `node scripts/src/merge-glb-anims.mjs <bodyGlb> <animDir>
<outGlb>`. It drops the body's placeholder clip, then per anim GLB copies each
channel's input/output accessors into the body doc and re-targets by node name.
Clip names come from the filename token between `Animation_` and `_withSkin`
(lower-cased), with overrides (`idle_10→idle`, `walking→walk`, `running→run`).

## Wiring notes

- `handBone: "Hand"` (it's a regex) matches BOTH `RightHand` and `LeftHand` so
  Character.findHands gets proper right+left mounts (for future shield/off-hand).
- `clips` only needs the roles you pin (idle/walk/run/attack); Character.autoMapClips
  fuzzy-fills jump/death/hurt/block from remaining clip names.
- `modelYaw` for the Meshy rig is an unverified guess (`Math.PI`); flip to `0` if he
  moonwalks — only the user's eyes can confirm (no WebGL in sandbox).
