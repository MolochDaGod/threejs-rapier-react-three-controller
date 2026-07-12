---
name: Animator Dressing Room weapon arsenal
description: How the Dressing Room equips/edits weapons on the procedural rig, and the WEAPON_GRIPS shared-reference gotcha.
---

# Dressing Room weapon arsenal (Arsenal panel)

The Dressing Room rig (procedural `ExplorerCharacter` via `EditorScene.loadRig`)
holds **no visible weapon** by default — `setRigWeapon`/`setWeaponId` only swap
the rig's *clip set*. To show a real weapon you must mirror the combat equip path
(`Studio.applyWeapon`): `rig.setWeaponId(id)` + `unmountWeapon(old)` +
`mountWeaponModel(def, rightHand, leftHand)`, and track the returned
`MountedWeapon` so you can unmount it.

**Why:** equip must bring the prefab's GLB model + grip + skill + VFX, not just
clips. EditorScene now owns this as `equipWeapon` / `mountCatalogModel`.

## WEAPON_GRIPS shared-reference gotcha
`WEAPON_GRIPS[id]` is built once at module load via `Object.fromEntries` and
shares the SAME object as `def.grip`. So mutating `def.grip.main.pos`/`.rot`
**properties** propagates live to the mounter. BUT a weapon that started
grip-less is absent from `WEAPON_GRIPS`; if you add a `def.grip` later you must
also set `WEAPON_GRIPS[def.id] = def.grip` or the mounter (which reads the table)
ignores it. Same for size: `def.model.main.length` is read on every mount, so
edit-then-remount persists the change for the session.

## Re-register safety
Mounted weapon Object3Ds live under the rig's hand bones. Tag them
`userData.__libWeapon = true` so `registerSubtree` (which already skips
`isColliderHelper`) doesn't capture them when the Animations panel re-registers
the rig after a clip-set swap.

## Custom (imported) weapons
Imported models promoted via `importWeapon` are equipped by `cloneSkinned`-ing
the scene node onto the main hand (id form `custom:<nodeId>`). The clone SHARES
geometry/materials with the source node — on unequip only `removeFromParent`,
never dispose. Placement is per-import overrides (uniform scale + pos/rot), not
prefab data.
