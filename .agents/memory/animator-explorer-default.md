---
name: Animator Explorer default character
description: How the procedural Explorer became the default Danger Room character; its rig is vendored and FBX self-hosted rather than pulled from @workspace/animator|assets.
---

# Animator artifact: procedural Explorer as default

The `animator` artifact (`@workspace/animator-app`) does NOT import
`@workspace/animator` or `@workspace/assets`. To reuse the shared procedural
character there, the animator library is **ported locally** (under
`src/three/explorer/`) and its FBX assets are **hosted in the artifact's own
`public/`** (loaded via a local `FBXLoader` against `${BASE_URL}anim/...`), not
pulled from `@workspace/assets`.

**Update (2026):** the old "forbids ALL `@workspace/*` imports" rule is OBSOLETE.
The artifact imports `@workspace/{epicfight,api-client-react,danger-net}` freely —
including inside `src/three/` (Studio, Targets, SparringCombat, …). The ONLY
standing constraint is the one above: the Explorer rig + its FBX stay
vendored/self-hosted rather than pulled from `@workspace/animator` /
`@workspace/assets`. Do NOT "fix" the valid workspace imports that exist today.

**How to apply / the contract:**
- Characters are polymorphic through an `Avatar` interface (types.ts). Both the
  GLB `Character` (role/clip-name based) and the procedural `ExplorerCharacter`
  (wraps the ported `Animator`, intent based) implement it. Drive characters
  only through `Avatar`, never the concrete classes.
- A `procedural` flag on `CharacterDef` is the single branch point. Anywhere the
  Studio behaves differently for the procedural rig (instantiation in
  `spawnCharacter`, weapon handling in `applyWeapon`) it must branch on
  `def.procedural`, NOT on `rightHand`/`leftHand` being null.
- Procedural rig has no hand bones: weapons are swapped via the Animator's own
  weapon class (`setWeaponId` → `WeaponId→WeaponClass` map → `Animator.setWeapon`),
  not by mounting an artifact weapon mesh.
- Controller updates BEFORE `character.update(dt)` each frame so Explorer can
  observe `root.position.y` for landing detection.
- Sandbox has no WebGL — Explorer visuals (boot, weapon swap, GLB⇄procedural
  swap) are manual-verify only.

## Two copies of the procedural rig (the lib copy is now orphaned)
The procedural Explorer rig exists in TWO places: the canonical lib at
`lib/animator/src/` (`Animator.ts`, `weapons.ts`, …) and the vendored copy under
`artifacts/animator/src/three/explorer/`. **HISTORICAL:** the lib copy used to be
consumed by the now-DELETED `@workspace/arcade` Explorer cabinet, which forced
lockstep edits across both copies (touch only the artifact copy and the arcade
saw a stale lib API). **With arcade deleted, the live animator artifact uses ONLY
its vendored copy and `lib/animator` currently has no shipping consumer.** Edit
the vendored copy under `src/three/explorer/` for any Danger Room change; only
touch `lib/animator/src/` if you intend to revive a lib consumer.
