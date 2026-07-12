---
name: Animator combat time-scale & live feel knobs
description: How global slow-mo, combo play-through, and live feel params are wired in the Danger Room, and the remount/raw-delta gotchas.
---

# Animator time-scale & live feel

The Danger Room (`artifacts/animator/src/three/Studio.ts` + `App.tsx`) drives
combat feel from live, runtime-read values, not constants.

## Global time-scale
- One `timeScale` field on Studio; the loop computes `raw = min(getDelta, 0.05)`
  then `dt = raw * timeScale`, and feeds `dt` to ALL sim/physics/animation/combat
  timers + the scheduler so slow-mo is consistent everywhere.
- **FPS readout and network snapshot cadence (`updateNet`) MUST use `raw`, not
  scaled `dt`.** Slow-mo is a local tuning tool; scaling net cadence throttles
  outbound multiplayer reports and scaling FPS makes the readout lie.

## Combo play-through
- Combo lock / chain window are derived from the clip duration the swing returns
  (`doComboHit`/`doKickCombo` return `number`), not a fixed constant: lock =
  dur*PLAYTHROUGH, window = dur+GRACE, with a constant fallback when dur=0.
  **Why:** fixed constants chopped swings off ~0.16-0.22s in regardless of clip
  length.

## Live feel knobs
- Feel values (gravity, move/turn speed, attackSteer) live on `EditorParams`,
  pushed via `Studio.setParams` and read each frame — editing a slider takes
  effect immediately. attackSteer is a clamped multiplier on the steer lerp in
  every melee steer site (`doComboHit`, `motionAttack`, `assistConfig().steer`).

## Remount gotcha
- **On every Studio remount (mode switch danger/play), App.tsx must re-apply
  `setParams` + `setTimeScale`.** A fresh Studio boots at defaults; React state
  still holds the user's values, so without re-applying, the UI shows e.g. 0.5x
  while the engine silently runs at 1.0. Setters only update the *current* live
  instance, never future ones.
