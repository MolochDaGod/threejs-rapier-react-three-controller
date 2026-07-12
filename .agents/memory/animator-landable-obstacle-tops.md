---
name: Animator landable obstacle tops
description: Danger Room prop tops (crates/barrels/pylons) are walkable support; how ground sampling, push-out skipping, supportY anchoring, and notifyLanded interact.
---

Danger Room (null-collision path) ground is no longer a flat y=0 plane.

**The rule:** obstacle circles carry an optional `top` (world Y). Finite `top` =
landable surface (crates, barrels, pylons, deployed props); undefined = infinite
cylinder (tall columns, corner pillars, live NPCs — never stand on combatants).
A pure `supportHeightAt(obstacles, x, z, fromY)` (src/three/support.ts, unit
tested) returns the highest landable top at/below the feet (`fromY + 0.05`
slack, `r + 0.15` edge pad), floor 0 otherwise.

**Why the `fromY` gate:** tops above the feet are wall faces — without the gate,
brushing a crate side teleports the body onto it.

**How to apply — pieces that must stay in lockstep:**
- Gravity clamp uses `groundY = supportHeightAt(pos, prevY)`; landing sets
  `supportY` and fires the existing justLanded flags.
- XZ push-out passes AND dashContactDistance must skip landable obstacles when
  the body/dash-origin is at/above `top - 0.02`, or standing on a top is
  ejected as an "overlap".
- Grounded walk-off: drop ≤ 0.3 snaps down (stair feel); deeper → grounded=false
  + `playRoleOnce("jump")` fall pose (guard with !isOneShotActive && !isBusy).
- Procedural specials (flip/roll/spin) anchor to `supportY`, never literal 0 —
  and any teleport (`blinkTo`, `setCollision` spawn) must refresh `supportY` or
  a follow-up special warps to the pre-teleport height.
- `Avatar.notifyLanded?()` is the ground-truth touchdown for rigs holding a
  looped airborne pose (Explorer): rigs must NOT infer landing from
  `root.y <= 0.02` alone (misses every elevated landing, incl. dungeon KCC
  floors — the KCC landing block also calls it). GLB rigs omit it.
