---
name: Animator weapon class wiring
description: How to add a new procedural-rig weapon class (and a character that spawns with it) in the animator Danger Room
---

# Adding a procedural weapon class to the animator Danger Room

The procedural "Explorer" box rig (NOT the GLB characters) selects its clip set
by `WeaponClass`. A weapon's `animSet` (a `WeaponAnimSet`) picks the class. To add
a brand-new class (e.g. `pistol`) you MUST thread it through every one of these,
or it silently falls back:

1. `explorer/types.ts` — add to the `WeaponClass` union.
2. `three/types.ts` — add to the `WeaponAnimSet` union (these two unions mirror
   each other; `ExplorerCharacter.setWeaponId` casts animSet → WeaponClass).
3. `explorer/clipCatalog.ts` — add an entry to `WEAPON_SETS`. It is typed as an
   exhaustive `Record<WeaponClass, WeaponClipSet>`, so a missing entry is a
   compile error (this is the safety net).
4. `explorer/loader.ts` — add the class to the DEFAULT preloaded classes array,
   or its FBX clips are never loaded and equipping it shows nothing.
5. `three/assets.ts` — point the relevant WEAPON's `animSet` at the new class.

**Combos:** there are two independent combo layers. `Studio.doComboHit` stages
VFX/movement on a hardcoded `stage % 3`; the ACTUAL clip is chosen by the
Animator cycling `WEAPON_SETS[class].combo` per `attack()` call. So extending a
class's `combo` array (plus adding the `ActionKey`s and `actions` entries) is what
surfaces new attack clips. `combo` length is unrelated to the `% 3` staging.

**Clip ids cross packs freely** — an action can reference any
`animations/<otherClass>/<file>` id, so a sparse pack (no fire/jump/death clip)
reuses another pack's clip as a fallback (e.g. pistol reuses bow fall + rifle
death/turn).

**Spawn-with-a-weapon:** `CharacterDef.defaultWeapon?: WeaponId` makes
`Studio.spawnCharacter` auto-equip that weapon (set before `applyWeapon`). Use it
for a procedural character that should start gun/blade-in-hand. The roster UI
(`AdminPanel.tsx`) auto-populates from the `CHARACTERS`/`WEAPONS` arrays, so a new
array entry needs no UI change.
