---
name: Animator elemental magic staffs
description: How the Fire/Ice/Storm/Nature/Holy staff arsenal is wired as data, not per-character kits.
---

# Elemental magic staffs

Each element (fire/ice/storm/nature/holy) is its OWN `WeaponId` (`staffFire`…`staffHoly`),
NOT a per-character signature kit. The whole family is driven by one optional data
field `WeaponDef.element?: StaffElement` plus the canonical `ELEMENT_THEME` table in
`arsenal/elements.ts` (color + status + StatusScope + projectile family + cast clip).

**Why:** so any character that equips an elemental staff casts that element — the cast
is a property of the weapon, not the wielder. Mirrors the bow/gun "one moveset, many
skins" tier model.

**How to apply:**
- Cast path: `Studio.useSkill` checks `getWeapon(this.weaponId).element` BEFORE the
  shared `skillCooldown` gate (right after the arcane `staff` Soulbinder branch) and
  delegates to `doElementalCast`, which owns its own cooldown/stamina. The plain
  Arcane `staff` (element undefined, `def.arcane`) keeps its bespoke Soulbinder path.
- `doElementalCast` reuses the arcane template verbatim: `abilities.cast(kitAbility(...))`
  → `onImpact` fires the themed `vfx.cast{Dragon,DarkBlades,Laser,Soul}At(from,to,color,onHit)`;
  `onHit` (at landing) does `aoeBlast` + `sparringBlast` (damage) + `applyStatusScoped`.
  Holy uses scope `"self"` so its `regen` lands on the caster.
- Skins: the 24 converted craftpix canes (`public/models/weapons/cane-N.glb`) are sliced
  into 6 tiers per element via a `caneTiers(start,label)` builder; tiers swap only
  `WeaponTier.model` (a bare `WeaponModelPiece`, same as bow tiers). Element colour is
  applied at mount by `Weapons.tintMats` (emissive) on the per-mount CLONED mats from
  `normalizeModel` — safe, never touches the shared template.
- Adding a new element = add the `StaffElement` literal, a `WeaponId`, an `ELEMENT_THEME`
  entry, a `magic.ts` `elementalStaff(...)` def, and the `WEAPON_ICON` + voxel
  `WEAPON_COLOR` Record entries (both are exhaustive `Record<WeaponId>` — TS enforces).
