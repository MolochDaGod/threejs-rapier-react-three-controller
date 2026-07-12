---
name: Heroes of Grudge prefabs
description: How the 24 race×class GLB hero prefabs are wired into the Danger Room (loadouts, embedded clips, hidden baked weapons).
---

The "Heroes of Grudge" are 24 playable Danger Room prefabs = 6 races × 4 classes,
built by a DRY loop in `assets.ts` (ids `grudge-<race>-<class>`).

**Rigs are Bip001, NOT mixamorig.** The shared FBX library can't retarget onto
Bip001, so every role/skill clip in a kit must point at a clip *embedded in the
GLB* (idle/walk/run/attack/jump plus class clips like sword_attack_a, bow_aim_walk_fwd,
magic_walk_fwd). Hands are `Bip001_R_Hand` / `Bip001_L_Hand`; `handBone: "Hand"`
matches both and `findHands` classifies L/R by `_R_`/`_L_`.

**Kits are class-based, not per-hero** (`GRUDGE_KITS`): each declares a 2-weapon
`loadout` (library WeaponIds), optional `offHand` (knight = shield), embedded
`clips`, and `signatureSkills` (embedded clip + shared VFX kind). Mages carry
elemental staffs that auto-cast from `WeaponDef.element`, so their sig clips are
cosmetic.

**Baked weapons are hidden, not removed.** Rigs ship baked weapon/shield/quiver
meshes; `CharacterDef.hideNodes` is a regex (`weapon|shield|quiver|xtra|_container`)
that `Character.load()` uses to set matching nodes `visible=false` — purely visual,
skeleton/clips/hands intact, so the mounted LIBRARY weapon is the only one shown.

**Loadout swap = Q.** `Studio.cycleLoadout()` advances `loadoutIndex` and re-applies
the weapon; `KeyQ` falls back to `sparring.parry()` when a character has <2 loadout.
`spawnCharacter` sets `weaponId=loadout[0]` + `offHandId=def.offHand??null` BEFORE
`applyWeapon` (which re-mounts the off-hand at the end of its async path).

**Remaining runtime risk:** library WEAPON_GRIPS were tuned for mixamorig hands;
grip position/orientation on Bip001 hands is only verifiable with WebGL (headless
sandbox has none). If a weapon floats/points wrong or the hero moonwalks, tune the
grip / flip `modelYaw` PI→0.
