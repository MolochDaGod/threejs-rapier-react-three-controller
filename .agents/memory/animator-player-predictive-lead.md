---
name: Animator player-side predictive lead
description: How player aimed projectiles lead a moving target, and the velocity source they read.
---

Player aimed projectiles (staff bolt, fire combo) lead a moving target using the
pure `leadTarget` solver in `src/three/anim/predictiveLead.ts`. The lead only
moves the projectile IMPACT point — facing/aim still tracks the target's current
position — and is clamped to a fraction of shooter→target distance so a real juke
still beats it.

**Velocity source:** `TargetHandle.velocity` (a planar XZ vector). It is NOT a
stored physics velocity — `Dummy.vel` is knockback only. `Targets.update` derives a
SMOOTHED finite-difference of each dummy's group position frame-to-frame (clamped
to bound teleport/respawn/knockback spikes) into `Dummy.velEstimate`, exposed via
the handle getter. Dungeon enemies have no smoothed estimate, so their handle
exposes planar `Enemy.vel` (knockback) as the best available source.

**Why:** any code adding a new `TargetHandle` literal must now also provide
`velocity` (the interface requires it) — there are handle factories in BOTH
`Targets.ts` (`handle()`) and `dungeon/DungeonEnemies.ts` (`handle()`).

**How to apply:** to give an aimed projectile predictive lead, pass
`leadTarget(from, target.position, target.velocity, projSpeed, { maxLeadFraction })`
and use the result only for the impact point. Representative projectile speeds for
the lead live as constants in `Studio.ts` (the VFX still own actual flight).
