---
name: Animator combo forward motion (MM system)
description: What "MM" means in the danger-room attack system and where combo forward gap-closer lives.
---

"MM" is the user's term for the **motion-math** attack/bounce system, NOT millimetres.
`MM_TO_M = 0.01` in Studio.ts (100 MM = 1 m of body displacement). Attacks describe
forward travel as MM via `MotionProfile { peak, settle?, impactAt }`, applied through
`controller.dash(dir, dist, dur, bounceBack, impactAt)`.

The 3-hit player combo lives in `Studio.doComboHit(stage)`:
- stage 0 = target-seeking gap-closer, distance-CLAMPED so it never overshoots a
  locked target (don't add forced forward here or you blow past the enemy).
- stages 1-2 = momentum lunges; this is where a deliberate forward gap-closer
  belongs. `COMBO_ADVANCE_MM` (MM units) drives net advance; keep recoil small
  (~0.12 of lunge) so ground gained isn't given back.

**Why:** user asked the combo to "move forward on each part" and chose an
aggressive ~1m+ gap-closer. GLB combo clips (melee-combo-1/2) CANNOT carry forward
motion — retarget drops position tracks and lockHorizontalRoot strips X/Z — so all
forward travel MUST be engine-driven via dash, not baked in the clip.

**How to apply:** to tune combo advance, change `COMBO_ADVANCE_MM`; it nets ~1m+
across hits 1-2. Combat feel is NOT verifiable in this sandbox (no WebGL) — tune
conservatively and let the user confirm in-app.
