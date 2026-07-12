---
name: Zombie cabinet gameplay feel
description: Movement smoothing, predictive animation queueing, and reticle/hit parity rules for the arcade zombie cabinet.
---

# Zombie cabinet "gameplay feel" rules

The arcade zombie cabinet (`artifacts/arcade/src/games/zombie/`) drives the
player with **velocity smoothing** + a shared **AnimatedActor base-state queue**.
A few non-obvious invariants must hold or it regresses:

## Velocity smoothing must not leak across movement overrides
- `ZombieGame` keeps a persistent smoothed `vel` and ramps it toward the input
  target with `1 - exp(-rate*dt)` (frame-rate independent). Any branch that moves
  the player **directly** (e.g. the dodge roll) bypasses `vel`.
- **Rule:** every direct-movement override must keep `vel` consistent with what
  it does (the roll sets `vel = rollDir * rollSpeed` each frame). If it doesn't,
  stale pre-roll velocity revives as a post-override glide once normal
  velocity-smoothed movement resumes.
- **Why:** symptom is an unintended drift/slide after a roll ends with no input.

## Reticle and bullet must share ONE enemy volume
- Aim convergence (`computeAimPoint` → `ray.intersectSphere`) and bullet hit
  registration (`updateBullets` point-vs-sphere) must use the **same** sphere,
  via the shared `enemyHitSphere(z, out)` (centre = enemy root `z.position`,
  radius = variant body radius).
- **Why:** if aim selects a torso-centred sphere but hits test a root-centred
  one, "reticle on body" and "shot lands" disagree vertically — the crosshair
  feels broken. Keep them on one helper so they can't drift apart.

## AnimatedActor predictive base queue (shared/three.ts)
- `setBase()` QUEUES `requestedBase`; `update()` commits it only after a dwell
  (`baseCommitDelay`: leaving idle = instant; settling TO idle lingers; other
  swaps short). One-shots own the rig until their clip ends, then resync to the
  **latest** requested base (which may have changed mid-reaction).
- **Why:** stops the locomotion base from machine-gunning between poses on
  rapid start/stop/turn input.
