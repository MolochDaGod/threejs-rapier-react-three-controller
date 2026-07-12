---
name: Animator predictive AI aim
description: How Danger Room AI leads moving targets for casts and dash gap-close without becoming undodgeable.
---

# Predictive AI aim (reach a moving target with timing)

Each AI `Dummy` keeps a smoothed planar target-velocity estimate
(`aimPrevTarget` / `aimTargetVel`, lerp ~0.3) computed in the perception update
in `Targets.ts`. Ranged casts and the dash gap-closer use it to LEAD where the
target is heading instead of aiming where it just was.

**Why:** Without leading, the AI always shoots/dashes at the stale position and
a strafing player trivially walks out of every attack — it never reads as skilled.
But a *perfect* lead is undodgeable and kills the skill-based feel the user wants.

**How to apply:**
- Cast lead = `aimTargetVel * CAST_LEAD_TIME`, **capped to
  `CAST_LEAD_FRACTION * shotDistance`** — the cap is what keeps a hard juke able
  to dodge. Do not remove or raise it without re-checking dodgeability.
- Dash gap-close blends `dir + aimTargetVel * GAPCLOSE_LEAD_TIME`, renormalized.
- **Reset the estimate on a target swap** (track `aimTargetId` = dummy id, or -1
  for the player): the position jump between two different targets would otherwise
  spike the velocity for one frame and fling the lead. Guard with a `dt > 1e-4`
  check and zero-init on first frame to avoid divide-by-zero / NaN.
