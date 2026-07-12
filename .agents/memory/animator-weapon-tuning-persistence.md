---
name: Animator weapon tuning persistence
description: How Dressing Room grip/size/blade-collider edits persist and reach combat
---

Weapon placement tuning (grip transform, longest-axis size, swept blade-collider
`hit` shape) authored in the Dressing Room arsenal tuner is persisted to
`localStorage` and re-applied onto the SHARED weapon catalog (`getWeapon(id)` defs
+ `WEAPON_GRIPS`) at engine construction (both the combat `Studio` and the
`EditorScene`).

**Why:** the catalog defs are module singletons the mounter reads at mount time,
so mutating them once at boot makes tuned values carry into BOTH the Dressing Room
and live combat, and survive a reload. Pushing values only into the live mount
would lose them on the next equip/reload.

**How to apply:**
- Apply is idempotent + guarded (`applied` flag) so calling from multiple engine
  constructors mutates the defs only once.
- The tuner writes fractions (edge start/end along the tip axis + radius); the
  stored `hit` is the resolved absolute `{a,b,radius}` in mount-local metres, read
  back into fractions using the mounted tip length.
- Tier variants that carry their own model must persist under a **tier-aware** key
  (`tiers[tier]`), not the base-def key — otherwise the tuner UI lets you edit a
  tier's grip/size but the change is silently lost on reload.
- Gate blade-collider editing by group eligibility via `resolveHitShape({group}, 1)`
  with NO `hit` passed — passing a synthetic `hit` always returns non-null and
  defeats the guard (ranged/magic/unarmed have no `HIT_DEFAULTS` → null).
