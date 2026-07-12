---
name: Animator throwable consumables
description: How player throwable/consumable actions (bomb, heal potion) are wired in the Danger Room and the heal-authority gotcha.
---

# Throwable / consumable player actions

Quick-draw throwables reuse the existing `throw` GLOBAL_ACTION clip + projectile/AoE
infra rather than new systems:
- The `throw` clip plays via `Avatar.playClipOnce("throw")`, which on the procedural
  rig routes to the explorer Animator's throw item gesture and **no-ops to duration 0
  on GLB rigs**. So a throwable action must work with `dur === 0` fallback timing
  (schedule release on a default beat) to be rig-agnostic.
- Lob a prop with `Vfx.thrownProp(modelPath, from, to, color, onLand)` (arc + on-land
  callback); detonate with `Vfx.aoeBlast` + `shockwave`, deal AoE damage with
  `Studio.sparringBlast(center, radius, dmg, force)`. Same pattern as bear-trap/soul-bomb.
- Gate like the other one-shots (`!character/controller`, `defeated`, `controller.isBusy`,
  own cooldown decremented in the main update loop).

**Explosion = VFX stack + split damage/knockback:** a satisfying AoE blast layers
several short-lived Vfx effects (core flash + GPU fireball + flame tongues + ember
spray + shockwaves + smoke) AND splits the gameplay result two ways — damage through
the sanctioned `sparringBlast` (defensive resolution + difficulty/PvP scaling) and a
**separate zero-damage `targets.launch(center, radius, 0, upVel>=8)`** for the clean
knock-up/outward-shove/topple reactions. Passing damage to `launch` on top of
`sparringBlast` double-counts; keep launch damage at 0 when a blast already dealt it.

**Heal-authority gotcha (the non-obvious part):** the player's HP is owned by the
player `CombatController` in `SparringCombat`. In solo/coop `Studio` overwrites
`this.health = sparring.getPlayerHealth()` every frame; in PvP `this.health` comes
from server snapshots. So a heal MUST go through the CC (`CombatController.heal()` →
`SparringCombat.healPlayer()`), never a raw `this.health +=`. A direct field write is
overwritten next frame in solo/coop and fights snapshot authority in PvP.
**Why:** keeps one source of truth for HP and avoids PvP cheating/desync.
