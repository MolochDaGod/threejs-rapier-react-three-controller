---
name: Animator Danger Room lunge/dash motion
description: How dash/kick skills must move the body in the animator artifact (Striker/Sanji + Sensei dash skills).
---

# Animator Danger Room — lunge / dash motion

The animator artifact (`artifacts/animator`, `@workspace/animator-app`) is the standalone
"Danger Room" playground. It FORBIDS `@workspace/*` imports — keep everything local.

## Rule: the real clip drives the body; motion is an eased spline timed to the clip
Dash / kick / lunge skills must:
- play the REAL animation clip (joint motion) as the primary driver, and layer OUR
  procedural VFX on top;
- move the root along an eased "spline" (ease-out in to a strike point, then ease back
  with an optional `bounceBack` for a ninja recoil) — `Controller.dash(dir, distance,
  duration, bounceBack=0, impactAt=0.5)`;
- derive the lunge `duration` from the played clip's length (e.g. `clipDur * 0.5`–`0.55`,
  clamped), so the body slide and the animation stay in lockstep;
- fire the impact (VFX + `targets.blast`) on the impact frame (`duration * impactAt`),
  mid-lunge, NOT when the slide finishes.

**Why:** the user explicitly rejected the old behavior where a skill played "a forced
animation from you, then runs the real one" — a hardcoded fixed-time snap-slide plus an
instant facing snap that read as a separate canned animation. They want the real clip +
our effect, as one smooth synced move.

**How to apply:** never hardcode dash duration independent of the clip; never hard-snap
`root.rotation.y` for a lunge (boost the turn rate during `dashActive` instead so it's a
fast-but-smooth commit). `Controller.consumeDashImpact()` exposes the impact frame.

## Character flags for martial artists
`CharacterDef` has optional `weaponless?: boolean` and `meleeStyle?: "kick"`. `weaponless`
characters (e.g. Sanji/"Striker") still record the player's weapon choice but mount
nothing, and `pushHud` must report `weapon:"none"` + a martial label so the HUD doesn't
show a phantom weapon. `meleeStyle:"kick"` routes every attack/skill through the foot-
lunge path (`doKickLunge`): face the best target in a forward cone (`pickTargetInFront`
over `targets.nearest`), lunge in, bounce back, impact VFX.

## Weapon combat profile + 3-hit combo
Each `WeaponDef` carries an optional `combat: WeaponCombat {intensity, direction, range:[min,max]m}`
(all 1-100 except range in meters); `weaponCombat(id)` returns a fully-defaulted profile so
callers never branch on undefined. These tune the LMB combo, NOT the signature skills.
- `direction` widens crosshair soft-aim (`Targets.raycast(ray, maxDist, softCos)`: direct
  ray-sphere first, then a cone fallback) AND the steer blend toward the picked target.
- `intensity` scales lunge distance + damage/force; `range` is the strike band.
- Combo state in `Studio`: `comboIndex/comboTimer/comboLock`. Hit 0 = fast dash-closer
  (`Controller.dash` shorter duration) that closes to ~mid of the range band and STOPS inside
  it (clamp `targetDist - desired` to `[0, dashDistance]`), with a mesh afterimage tail; hits
  1-2 = short momentum lunges; hit 2 = finisher (×1.6 dmg / ×1.5 force / +radius).

**Hit geometry rule:** resolve the blast at the MID of the reach band ahead of the
body-at-impact (`center = body + dir*(rMin+rMax)/2`), radius `= (rMax-rMin)/2 + margin`. Never
offset/scale the hit by raw `rMax` — that gives long weapons an oversized AoE that hits well
outside their intended reach.

## Targets are solid: lunges bounce, don't clip through
A lunge that reaches a physical target must stop at its surface and recoil out, not
pass through. `Controller.dash` computes a contact distance via ray↔circle (XZ) against
the SAME `obstacles()` provider used for the per-frame push-out (combatant footprints +
props, inflated by the player radius), only on the flat Danger Room path (skipped when a
dungeon collision provider owns collision). On contact it clamps the eased peak to the
surface and reverses the leftover distance.

**Why:** the easing spline kept driving the body forward each frame while the post-move
push-out ejected it, so lunges stuck/clipped at the surface instead of bouncing.

**How to apply:** the contact recoil is FLOORED at the launch point (never behind origin)
and overrides any caller `bounceBack` — point-blank combo hits (body already adjacent →
contact 0) must not fling the character backward across the arena. Don't "fix" this floor
to allow negative settle without re-checking the combo feel.

## Mesh afterimage (motion-blur tail)
`Vfx.afterimage` clones the live character with `SkeletonUtils.clone` (from
`three/examples/jsm/utils/SkeletonUtils.js`). The clone SHARES geometry, so the ghost effect
MUST set `Effect.shared = true` and `Vfx.free` must skip disposing shared geometry/maps — only
dispose the cloned additive materials. Disposing shared geometry corrupts the real character.

## Crosshair facing
`Controller.faceToward(dir, boost)` sets `wantFacing` + a short `facingBoost` timer that raises
the turn rate (so the body smoothly snaps toward the crosshair target before a hit, not an
instant rotation snap — same rule as the lunge above). Honored in the facing block alongside
`dashActive`. Double-jump (`consumeDoubleJump`) does a deterministic horizontal `dash` toward the
crosshair target; vertical arc is preserved because gravity integrates AFTER the dash block.

## Data-driven Striker fire-kick (template for Boxer/Tera-kasi)
A `meleeStyle:"kick"` character can carry an optional `kick?: StrikerCombat` profile
(`palette` core/flame/ember + N `combo` steps + 4 `skills` keyed by a `behavior` enum).
When present, LMB runs `doKickCombo(stage)` and signatures run `useKickSkill(index)` which
dispatches by `skill.behavior` — `lunge` / `launcher` / `aerialProjectile` / `hover`. With
NO profile both paths fall back to the old `doKickLunge`, so this is purely additive.

**Why:** the rig is a low-bone Sketchfab character; Mixamo FBX (Back_Flip_To_Uppercut,
Falling_To_Roll, Flip_Kick) CANNOT retarget onto it. So motion = the rig's OWN native
clips + procedural Controller motion + fire VFX, NOT imported clips. In-scope FBX are
self-hosted unwired under `public/anim/animations/striker/` for a future higher-bone rig.

**How to apply:** combo steps drive behavior via fields — `lift>0` → `Targets.launch`
(vertical pop, target stays framed) else `blast` (knock away); `hop>0` → self bounce;
last step adds `flameCone`. Procedural verbs live on `Controller`: `hop/backflip(in-place,
no recoil)/hover(jump cancels)/aerialSpin(consumeSpinEnd)/rollOut`. Each tumble mode
suspends gravity + gates locomotion in `update()` and MUST reset `root.rotation.x` on exit
(facing only uses `.y`). Landing telemetry (`landingInfo.speed/doubled`) drives the
landing roll-out (double-jump OR hard fall). `aerialProjectile` stashes a pending
`spinSkill` and fires `flameSlashProjectile` toward the crosshair on `consumeSpinEnd`.

Note: no GPU in the sandbox ("WebGL unavailable") — visual feel must be verified by the
user in a real browser; typecheck is the only automated guard here.

## Clean knock-up launcher chain (Targets.ts)

A "clean" launch (`Targets.launch()` with `upVel >= 8` — kick/uppercut, not small
juggle lifts) runs a host-driven aerial chain on the victim Dummy via a
`launchPhase?: "rising"|"falling"` field: set `vel.y ≈ sqrt(2*g*h)` (g=22 ⇒ ~2m
apex) + play `knockedUp`/`knockedUpBack`; the update loop swaps to `fallingIdle`
once descending, and on landing forces `cc.applyVulnerableState("fallen")` + held
`knockedUnconscious` (a deeper rag-doll KO collapse) so it always ends prone (and Stomp-able).
**Why:** the CombatController is pure logic (no vertical motion); reaction clips
have locked roots, so the arc + clip sequencing must live host-side.
**How to apply:** (1) guard the per-frame reaction hook with `if (d.launchPhase)`
so a mid-air `applyAttack` stagger doesn't override the rig clip; (2) on landing
you must BOTH fire `onEnemyState(...,"fallen")` (knock-down VFX) AND set
`d.lastState = cc.getState()` to stop the hook replaying the generic fall clip;
(3) clear `launchPhase` on death AND in `revive()` or a fighter killed mid-air
lands back into a forced knock-down next life. DungeonEnemies.ts deliberately NOT
mirrored (its loop integrates only x/z, floor height ≠ 0); `launchPhase` is an
internal Dummy field, not part of the shared CombatTargets interface.
