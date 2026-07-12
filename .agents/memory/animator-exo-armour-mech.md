---
name: Animator Exo-Armour Mech Mode
description: How the "suit up into a rideable mech" feature is structured and the Studio state-conflict traps it must avoid.
---

# Exo-Armour Mech Mode

The currently-controlled fighter can toggle into a rideable exo-armour mech and
fight as it, then toggle back out (pilot released).

## Shape

- Asset is a rebuilt multi-clip GLB (`mech-00.glb`, built by
  `scripts/src/build-mech-glb.mjs` from the user's Mech FBX pack): Idle/Walk/Run
  loops are weight-blended by pilot speed, and the suit-up "morph" SCRUBS the
  stand→crouch clip (opening holds the crouched end pose, enclosing scrubs
  end→start to rise while sealing, exiting scrubs start→end to kneel back down)
  — a paused, clamped LoopOnce action whose `.time` is set from phase progress.
  Only cadence/lean stay procedural. Normalize at load (fit a target height,
  recentre X/Z, base→Y=0) and cache the template; per-instance clones use
  `SkeletonUtils` and share geo/materials.
- Aim: camera pitch never tilts the chassis. `setAimTilt` leans ONLY the spine
  bone post-mixer (premultiply local quat by `qParent⁻¹·R(levelRight)·qParent`),
  and the widened look-up/down pitch clamp is a Controller `setPitchRange` /
  `resetPitchRange` pair driven by the reconciler host on piloted edges AND in
  `cancel()` — any takeover teardown must restore the default clamp.
- The phase machine lives in `src/three/mech/mechState.ts` and is **pure (no
  THREE)** so it is unit-testable: `idle→opening→enclosing→piloted→exiting→idle`
  with derived flags (`pilotVisible`/`mechVisible`/`enclosed`/`mechControlled`)
  and a `closure` 0..1. `MechSystem.ts` is the THREE wrapper Studio owns.
- **Binding is KeyM, not KeyG** — KeyG is already `evade()`. Don't reach for KeyG.

## Why the Studio-integration edge cases matter

**The mech is a parallel "who controls the avatar" mode that fights other Studio
systems that also write `character.root.visible` and the Controller speed
multiplier.** Any context that hijacks the player avatar must reconcile with it:

- **Duel spectating** (`startDuel`) hides the player and hands the arena to the
  Duel orchestrator. If you don't tear the mech down first it lingers in-scene and
  keeps the speed/visibility overrides. Use a single `cancelMech()` helper
  (forceIdle + reset prev-controlled/cooldown + restore base speed if it had
  control + restore visibility respecting `spectating`).
- **Smoke-Phantom buff expiry** unconditionally restores `visible=true` + base
  speed. While suited up that would un-hide the pilot / drop mech speed mid-pilot —
  guard that restore with `!mech.isActive`.

**How to apply:** when adding any new avatar-takeover mode (spectator views,
cutscene cams, possession), audit every place that writes `character.root.visible`
or `controller.setSpeedMultiplier` and make them mech-aware, and call `cancelMech()`
on entry to contexts that fully replace the player avatar.

## Heavy-mech feel (procedural)

The single embedded clip can't carry locomotion, so "weight" is layered on
procedurally and routed as discrete *feel events* the Studio reacts to:

- `MechSystem.update` returns a `MechFrame` (not the bare snapshot): `{ snap,
  footstep, justOpened, justSealed, justReleased }`. Transition edges are
  edge-detected from a tracked prevPhase/prevEnclosed; reset them in `forceIdle`.
- `ExoArmor.updateLocomotion(dt, speed, piloted)` drives the walk on the **inner**
  group (scale stays owned by `setClosure`, so locomotion only touches
  `inner.position`/`inner.rotation`): foot-plant heave, weight sway, forward
  pitch, roll-lean from yaw rate. Returns `{side}` on a plant; MechSystem maps it
  to a world foot pos. Speed is normalized as `speed/0.9` (controller's ~0.65 run
  threshold).
- Camera shake lives in `Controller` as trauma (0..1, decays, screen offset =
  trauma²). `addCameraShake(amount)` pumps impulses; the offset is undone before
  the next base pose so the lerped third-person cam never drifts. Studio feeds it
  on footsteps (~0.22), seal (~0.55), landing (~0.6), slam (~0.7), punch (~0.3).
- **Why:** keeps the pure state machine untouched/unit-tested and keeps the one
  camera owner (Controller) authoritative over shake. Visual tuning is
  headless-unverifiable — needs a human pass.

## Disposal

Standard cached-template rule: dispose only owned clones/materials, NEVER the
shared template geo/materials.
