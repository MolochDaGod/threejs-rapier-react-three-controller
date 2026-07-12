---
name: Animator target-lock & HUD projection
description: Danger Room lock-on stance, motion-math attacks, and the behind-camera HUD-projection gotcha.
---

# Target lock-on (Danger Room, artifacts/animator)

- RMB-hold engages a lock stance AND keeps block/parry: `startBlock` sets
  `blocking` and calls `Targets.acquireNearest(playerPos)`; `endBlock`/defeat
  clear both. The loop refreshes `Targets.lockPoint()` every frame and
  auto-releases when the target dies.
- `Controller.setLockTarget(p)` drives the stance. In `update()`: suppress mouse
  yaw while locked (`if (!lockTarget) yaw -= dx`), damp camera yaw toward the
  target (`yaw += d * min(1, 9*dt)`), and **override `wantFacing = lockYaw` LATE**
  (after movement writes, gated on `!spinActive`) so A/D reads as a strafe instead
  of turning to face the move direction. Movement basis stays the normal
  `forward()`/`right` camera-relative pair — do not touch it.
- Tab cycles enemy selection ("always"), admin hotkey lives on Backquote (moved
  off Tab so Tab is free for targeting).

# Motion-math attacks
- `MM_TO_M = 0.01` (100 motion-math units = 1 m), one tunable knob. A
  `MotionProfile {peak, settle?, impactAt}` maps to
  `Controller.dash(dir, peak*MM_TO_M, dur, peak-settle, impactAt)`.
- `dash` already handles **signed** reach: `peak<0` = retreating attack,
  `peak>0 settle<0` = lunge-through that recoils behind the start. No special
  casing needed in `dashDisplacement` (signed reach + lerp to settle).

# Behind-camera HUD projection gotcha
- `vec.project(camera)` returns NDC where points **behind** the camera still map
  to plausible on-screen x/y but with `z > 1`. Guarding with `z <= 1` ALONE is
  not enough — a bare `z<=1` is true for some behind-camera points and draws a
  ghost frame. Require `z >= -1 && z <= 1 && |x| <= 1 && |y| <= 1` before
  converting to pixels.
- **Why:** caught in architect review of the target health-frame; the frame would
  flicker on-screen when the locked enemy was behind the player.
